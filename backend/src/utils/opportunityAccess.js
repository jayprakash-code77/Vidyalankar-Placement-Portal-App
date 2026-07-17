const { OPPORTUNITY_BROADCAST_ALL } = require("../constants/departments");

const escapeRegex = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const norm = (s) => String(s || "").trim().toLowerCase();

/**
 * Departments listed on an opportunity (comma-separated) plus broadcast token.
 */
const parseOpportunityDepartments = (departmentField) => {
  if (!departmentField && departmentField !== 0) return [];
  const raw = String(departmentField).trim();
  if (!raw) return [];
  if (norm(raw) === norm(OPPORTUNITY_BROADCAST_ALL)) return [OPPORTUNITY_BROADCAST_ALL];
  return raw
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
};

/**
 * True if the user's single department matches the opportunity audience
 * (all-depts token or comma-separated list), case-insensitive.
 */
const userDepartmentMatchesOpportunity = (userDepartment, opportunityDepartment) => {
  const u = norm(userDepartment);
  if (!u) return false;
  const parts = parseOpportunityDepartments(opportunityDepartment).map((d) => norm(d));
  if (parts.length === 0) return false;
  if (parts.includes(norm(OPPORTUNITY_BROADCAST_ALL))) return true;
  return parts.includes(u);
};

/**
 * Mongo $match fragment for student/faculty: "all" or comma-separated dept includes user's dept.
 */
const buildDepartmentAudienceMatch = (userDepartment) => {
  const trimmed = String(userDepartment || "").trim();
  if (!trimmed) {
    return { department: { $in: [] } };
  }
  const escaped = escapeRegex(trimmed);
  return {
    $or: [
      { department: OPPORTUNITY_BROADCAST_ALL },
      { department: new RegExp(`(^|,)\\s*${escaped}\\s*(,|$)`, "i") },
    ],
  };
};

const isCreator = (opportunity, user) =>
  Boolean(opportunity?.createdBy && user?._id && String(opportunity.createdBy) === String(user._id));

const canFacultyCollaborateOnOpportunity = (user, opportunity) => {
  if (!user || user.role !== "faculty" || !opportunity) return false;
  if (isCreator(opportunity, user)) return true;
  return userDepartmentMatchesOpportunity(user.department, opportunity.department);
};

const canFacultyDeleteOpportunity = (user, opportunity) => {
  if (!user || !opportunity) return false;
  if (user.role === "admin") return true;
  if (user.role !== "faculty") return false;
  return isCreator(opportunity, user);
};

const canFacultyEditOpportunityContent = (user, opportunity) => {
  if (!user || !opportunity) return false;
  if (user.role === "admin") return true;
  if (user.role !== "faculty") return false;
  return canFacultyCollaborateOnOpportunity(user, opportunity);
};

const canViewOpportunityAsAudience = (user, opportunity) => {
  if (!user || !opportunity) return false;
  if (user.role === "admin") return true;
  if (user.role !== "student" && user.role !== "faculty") return false;

  // Check department match
  const deptMatch = userDepartmentMatchesOpportunity(user.department, opportunity.department);
  if (!deptMatch) return false;

  // Check year eligibility for students
  if (user.role === "student" && opportunity.eligibleYears) {
    const userYear = user.year;
    if (!userYear || !opportunity.eligibleYears.includes(userYear)) {
      return false;
    }
  }

  // Check gender eligibility for students (backend-only filter)
  if (user.role === "student" && Array.isArray(opportunity.eligibleGenders) && opportunity.eligibleGenders.length > 0) {
    if (user.gender && !opportunity.eligibleGenders.includes(user.gender)) {
      return false;
    }
  }

  // Check academic eligibility for students (SSC / HSC / CGPA minima)
  if (user.role === "student" && !studentMeetsAcademicEligibility(user.academicInfo, opportunity)) {
    return false;
  }

  return true;
};

const hasNumericValue = (value) =>
  value !== undefined && value !== null && value !== "" && !Number.isNaN(Number(value));

/**
 * True if the student satisfies every defined academic minimum on the opportunity.
 * Null / missing opportunity criteria are ignored.
 */
const studentMeetsAcademicEligibility = (academicInfo = {}, opportunity = {}) => {
  const checks = [
    { required: opportunity.sscPercentage, actual: academicInfo?.sscPercentage },
    { required: opportunity.hscPercentage, actual: academicInfo?.hscPercentage },
    { required: opportunity.cgpa, actual: academicInfo?.cgpa },
  ];

  for (const { required, actual } of checks) {
    if (!hasNumericValue(required)) continue;
    if (!hasNumericValue(actual)) return false;
    if (Number(actual) < Number(required)) return false;
  }
  return true;
};

/**
 * Build a Mongo $match fragment for year-based filtering
 * If eligibleYears is set, student must match one of those years
 */
const buildYearEligibilityMatch = (userYear) => {
  if (!userYear) {
    return { eligibleYears: { $exists: false } };
  }
  return {
    $or: [
      { eligibleYears: { $exists: false } },
      { eligibleYears: { $size: 0 } },
      { eligibleYears: userYear },
    ],
  };
};

/**
 * Build a Mongo $match fragment for gender-based filtering (students only).
 * Opportunities without gender restriction or missing student gender remain visible.
 */
const buildGenderEligibilityMatch = (userGender) => {
  if (!userGender) {
    return {};
  }
  return {
    $or: [
      { eligibleGenders: { $exists: false } },
      { eligibleGenders: { $size: 0 } },
      { eligibleGenders: userGender },
    ],
  };
};

/**
 * Build a Mongo $match fragment for academic eligibility (students only).
 * Uses top-level $and so it does not overwrite department/year/gender $or filters.
 * Null / missing opportunity criteria are treated as no restriction.
 */
const buildAcademicEligibilityMatch = (academicInfo = {}) => {
  const buildFieldMatch = (field, studentValue) => {
    const unrestricted = [
      { [field]: { $exists: false } },
      { [field]: null },
    ];
    if (hasNumericValue(studentValue)) {
      return {
        $or: [...unrestricted, { [field]: { $lte: Number(studentValue) } }],
      };
    }
    // Student has no value — only opportunities without this criterion
    return { $or: unrestricted };
  };

  return {
    $and: [
      buildFieldMatch("sscPercentage", academicInfo?.sscPercentage),
      buildFieldMatch("hscPercentage", academicInfo?.hscPercentage),
      buildFieldMatch("cgpa", academicInfo?.cgpa),
    ],
  };
};

module.exports = {
  escapeRegex,
  parseOpportunityDepartments,
  userDepartmentMatchesOpportunity,
  buildDepartmentAudienceMatch,
  buildYearEligibilityMatch,
  buildGenderEligibilityMatch,
  buildAcademicEligibilityMatch,
  studentMeetsAcademicEligibility,
  isCreator,
  canFacultyCollaborateOnOpportunity,
  canFacultyDeleteOpportunity,
  canFacultyEditOpportunityContent,
  canViewOpportunityAsAudience,
};
