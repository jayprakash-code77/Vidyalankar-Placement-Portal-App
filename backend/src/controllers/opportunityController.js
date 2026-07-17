const Opportunity = require("../models/Opportunity");
const OpportunityAttendance = require("../models/OpportunityAttendance");
const User = require("../models/User");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");
const { sanitizeString } = require("../utils/sanitize");
const { ok, fail } = require("../utils/apiResponse");
const { getTodayStart, normalizeDateToStartOfDay, getStatusFromLastDate } = require("../utils/dateUtils");
const { OPPORTUNITY_BROADCAST_ALL, isValidOpportunityDepartment, DEPARTMENTS } = require("../constants/departments");
const { GENDER_OPTIONS } = require("../models/User");
const {
  buildDepartmentAudienceMatch,
  buildYearEligibilityMatch,
  buildGenderEligibilityMatch,
  buildAcademicEligibilityMatch,
  studentMeetsAcademicEligibility,
  userDepartmentMatchesOpportunity,
  canFacultyCollaborateOnOpportunity,
  canFacultyDeleteOpportunity,
  canFacultyEditOpportunityContent,
  canViewOpportunityAsAudience,
} = require("../utils/opportunityAccess");
const {
  generateApplicantsCSV,
  generateApplicantsFilename,
  generateResumesZipFilename,
} = require("../utils/csvExport");
const { sortApplicantsAlphabetically } = require("../utils/applicantSort");
const { sanitizeFilenameForOS } = require("../utils/filenameUtils");
const { sendEmail } = require("../utils/sendEmail");
const {
  buildAttendanceMap,
  getRoundCsvLabel,
  RECRUITMENT_STAGE_ORDER,
} = require("../utils/roundAnalytics");

const deriveStatusFromLastDate = (lastDate) => {
  console.log(`[OPPORTUNITY]  deriveStatusFromLastDate - SINGLE SOURCE OF TRUTH`);
  console.log(`[OPPORTUNITY] Input lastDate:`, lastDate);
  const status = getStatusFromLastDate(lastDate);
  console.log(`[OPPORTUNITY]  Derived status: ${status}`);
  return status;
};


const syncOpportunityStatuses = async () => {
  console.log(`\n[OPPORTUNITY SYNC] ========== STARTING STATUS SYNC ==========`);
  console.log(`[OPPORTUNITY SYNC] RULE: Archive ONLY if today is AFTER lastDate (today > lastDate)`);
  console.log(`[OPPORTUNITY SYNC] This means an opportunity remains ACTIVE through entire lastDate\n`);

  const todayStart = getTodayStart();
  const todayDate = todayStart.toISOString().split("T")[0];

  console.log(`[OPPORTUNITY SYNC] Today's normalized date: ${todayDate} (${todayStart.getTime()})`);

  try {
    // Get all opportunities to check their status
    const allOpportunities = await Opportunity.find({}, {
      _id: 1,
      announcementHeading: 1,
      lastDate: 1,
      status: 1
    });

    console.log(`[OPPORTUNITY SYNC] Total opportunities in database: ${allOpportunities.length}`);

    // Check first few for logging
    allOpportunities.slice(0, 5).forEach(op => {
      const opLastDate = op.lastDate ? op.lastDate.toISOString().split("T")[0] : "null";
      const derivedStatus = deriveStatusFromLastDate(op.lastDate);
      const statusMatches = op.status === derivedStatus;
      console.log(`[OPPORTUNITY SYNC] Sample - ID: ${op._id}, lastDate: ${opLastDate}, currentStatus: ${op.status}, derivedStatus: ${derivedStatus}, match: ${statusMatches}`);
    });

    const archivedResult = await Opportunity.updateMany(
      { lastDate: { $lt: todayStart }, status: { $ne: "archived" } },
      { $set: { status: "archived" } }
    );
    console.log(`[OPPORTUNITY SYNC] ✓ Archived ${archivedResult.modifiedCount} opportunities (lastDate < ${todayDate})`);

    const activatedResult = await Opportunity.updateMany(
      { lastDate: { $gte: todayStart }, status: { $ne: "active" } },
      { $set: { status: "active" } }
    );
    console.log(`[OPPORTUNITY SYNC] ✓ Activated ${activatedResult.modifiedCount} opportunities (lastDate >= ${todayDate})`);
    console.log(`[OPPORTUNITY SYNC] ========== STATUS SYNC COMPLETE ==========\n`);
  } catch (error) {
    console.error(`[OPPORTUNITY SYNC ERROR]`, error.message);
  }
};

const validatePayload = (payload) => {
  const required = [
    "announcementHeading",
    "type",
    "description",
    "lastDate",
    "department",
  ];
  for (const field of required) {
    if (!payload[field]) return `${field} is required`;
  }
  if (payload.applicationLink) {
    try {
      const parsed = new URL(payload.applicationLink);
      if (!["http:", "https:"].includes(parsed.protocol)) return "applicationLink must start with http/https";
    } catch {
      return "applicationLink must be a valid URL";
    }
  }
  if ((payload.description || "").length > 10000) return "description must be <= 10000 characters";
  const selectedDate = new Date(payload.lastDate);
  if (Number.isNaN(selectedDate.getTime())) return "lastDate must be a valid date";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  selectedDate.setHours(0, 0, 0, 0);
  if (selectedDate < today) return "lastDate cannot be in the past";
  return null;
};

const parseOptionalAcademicNumber = (value, min, max, label) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new Error(`${label} must be a number`);
  }
  if (n < min || n > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return n;
};

const parseAcademicEligibilityFields = (body = {}, existing = {}) => {
  const resolve = (key, min, max, label) => {
    if (body[key] === undefined) {
      return existing[key] !== undefined ? existing[key] : null;
    }
    return parseOptionalAcademicNumber(body[key], min, max, label);
  };
  return {
    sscPercentage: resolve("sscPercentage", 0, 100, "SSC percentage"),
    hscPercentage: resolve("hscPercentage", 0, 100, "HSC percentage"),
    cgpa: resolve("cgpa", 0, 10, "CGPA"),
  };
};

const parseEligibleGenders = (raw) => {
  if (!raw) return GENDER_OPTIONS;
  const values = Array.isArray(raw)
    ? raw.map((item) => sanitizeString(String(item))).filter(Boolean)
    : String(raw)
        .split(",")
        .map((item) => sanitizeString(item))
        .filter(Boolean);
  if (values.length === 0) return GENDER_OPTIONS;
  const invalid = values.filter((g) => !GENDER_OPTIONS.includes(g));
  if (invalid.length > 0) {
    throw new Error(`Invalid gender filter values: ${invalid.join(", ")}`);
  }
  return values;
};

const normalizeOpportunity = (doc, userEmail = null) => {
  const raw = doc?.toObject ? doc.toObject() : doc;
  if (!raw) return raw;

  const normalized = { ...raw, id: String(raw._id) };

  // Add hasApplied field for students
  if (userEmail) {
    normalized.hasApplied = raw.applications?.some(app => app.studentEmail === userEmail) ?? false;
  }

  return normalized;
};

const isArchivedOpportunity = (opportunity) => deriveStatusFromLastDate(opportunity.lastDate) === "archived";

const listOpportunities = async (req, res) => {
  try {
    console.log(`[OPPORTUNITY LIST][START]`, {
      userEmail: req.user.email,
      userRole: req.user.role,
      userDepartment: req.user.department
    });

    await syncOpportunityStatuses();

    const filter = {};
    if (req.user.role === "student" || req.user.role === "faculty") {
      Object.assign(filter, buildDepartmentAudienceMatch(req.user.department));

      // Add year-based eligibility filtering for students
      if (req.user.role === "student" && req.user.year) {
        Object.assign(filter, buildYearEligibilityMatch(req.user.year));
      }
      if (req.user.role === "student" && req.user.gender) {
        Object.assign(filter, buildGenderEligibilityMatch(req.user.gender));
      }
      if (req.user.role === "student") {
        Object.assign(filter, buildAcademicEligibilityMatch(req.user.academicInfo));
      }
    }

    const pipeline = [
      { $match: filter },
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "createdByUser"
        }
      },
      {
        $addFields: {
          createdByEmail: { $arrayElemAt: ["$createdByUser.email", 0] },
          createdByRole: { $arrayElemAt: ["$createdByUser.role", 0] },
          applicationCount: { $size: { $ifNull: ["$applications", []] } }
        }
      },
      {
        $project: {
          createdByUser: 0
        }
      },
      { $sort: { createdAt: -1 } }
    ];

    const items = await Opportunity.aggregate(pipeline);

    console.log(`[OPPORTUNITY LIST][RESULTS]`, {
      totalCount: items.length,
      active: items.filter(o => o.status === "active").length,
      archived: items.filter(o => o.status === "archived").length,
      userRole: req.user.role
    });

    // Log first few opportunities for debugging
    items.slice(0, 3).forEach(op => {
      console.log(`[OPPORTUNITY LIST][ITEM]`, {
        id: op._id,
        heading: op.announcementHeading?.substring(0, 30),
        lastDate: op.lastDate?.toISOString().split("T")[0],
        status: op.status,
        department: op.department
      });
    });

    return ok(res, items.map(normalizeOpportunity));
  } catch (error) {
    console.error(`[OPPORTUNITY LIST][ERROR]`, error.message);
    return fail(res, 500, "Failed to fetch opportunities", error.message);
  }
};

const getOpportunityById = async (req, res) => {
  try {
    const opportunity = await Opportunity.findById(req.params.id)
      .populate({
        path: 'createdBy',
        select: 'email name',
        model: 'User'
      });
    if (!opportunity) {
      console.warn(`[OPPORTUNITY] Not found: ${req.params.id}`);
      return fail(res, 404, "Opportunity not found");
    }

    // Role-based access control
    if (req.user.role === "student" || req.user.role === "faculty") {
      const userDept = req.user.department;
      const hasUserDept = userDepartmentMatchesOpportunity(userDept, opportunity.department);

      if (!hasUserDept) {
        console.warn(
          `[OPPORTUNITY 403] ${req.user.role} ${req.user.email} denied access to opportunity ${req.params.id}:`,
          `Expected audience for: [${opportunity.department}], Got user dept: ${userDept}`
        );
        return fail(res, 403, `Forbidden - opportunity not available for your department (${userDept})`);
      }

      // Check year eligibility for students
      if (req.user.role === "student" && opportunity.eligibleYears && opportunity.eligibleYears.length > 0) {
        if (!opportunity.eligibleYears.includes(req.user.year)) {
          console.warn(
            `[OPPORTUNITY 403] Student ${req.user.email} denied access due to year mismatch:`,
            `Required years: [${opportunity.eligibleYears.join(", ")}], Student year: ${req.user.year}`
          );
          return fail(res, 403, `Forbidden - opportunity not available for your year (${req.user.year})`);
        }
      }

      if (
        req.user.role === "student" &&
        !studentMeetsAcademicEligibility(req.user.academicInfo, opportunity)
      ) {
        console.warn(
          `[OPPORTUNITY 403] Student ${req.user.email} denied access due to academic eligibility`
        );
        return fail(res, 403, "Forbidden - you do not meet the academic eligibility criteria");
      }
    }

    console.log(`[OPPORTUNITY ✓] ${req.user.role} ${req.user.email} accessed opportunity ${req.params.id}`);
    // Normalize the populated opportunity
    const opp = opportunity.toObject();
    const normalized = {
      ...opp,
      id: String(opp._id),
      createdByEmail: opp.createdBy?.email,
      createdByRole: opp.createdBy?.role
    };
    return ok(res, normalized);
  } catch (error) {
    return fail(res, 500, "Failed to fetch opportunity", error.message);
  }
};

const createOpportunity = async (req, res) => {
  try {
    console.log(`[OPPORTUNITIES][CREATE_START]`, {
      userEmail: req.user.email,
      userRole: req.user.role,
      receivedLastDate: req.body.lastDate
    });

    const normalizedLastDate = normalizeDateToStartOfDay(req.body.lastDate);
    const status = deriveStatusFromLastDate(normalizedLastDate);

    console.log(`[OPPORTUNITIES][DATE_PROCESSING]`, {
      receivedLastDate: req.body.lastDate,
      normalizedLastDate: normalizedLastDate?.toISOString().split("T")[0],
      derivedStatus: status
    });

    let academicFields;
    try {
      academicFields = parseAcademicEligibilityFields(req.body);
    } catch (academicError) {
      return fail(res, 400, academicError.message);
    }

    const payload = {
      ...req.body,
      announcementHeading: sanitizeString(req.body.announcementHeading),
      description: sanitizeString(req.body.description),
      applicationLink: req.body.applicationLink ? sanitizeString(req.body.applicationLink) : "",
      department: sanitizeString(req.body.department),
      type: sanitizeString(req.body.type),
      eligibilityCriteria: Array.isArray(req.body.eligibilityCriteria)
        ? req.body.eligibilityCriteria.map(sanitizeString).filter(Boolean).join(", ")
        : sanitizeString(req.body.eligibilityCriteria),
      createdBy: req.user._id,
      createdName: req.user.name || req.user.email || "Unknown",
      lastDate: normalizedLastDate,
      eligibleGenders: parseEligibleGenders(req.body.eligibleGenders),
      ...academicFields,
    };

    // Faculty can only create opportunities for their own department
    if (req.user.role === "faculty") {
      if (!req.user.department || req.user.department.trim() === "") {
        console.error('[OPPORTUNITIES][FACULTY_NO_DEPT]', { userId: req.user._id, email: req.user.email });
        return fail(res, 400, "Your profile doesn't have a department assigned. Please contact admin.");
      }
      const facultyDept = req.user.department.trim();
      payload.department = facultyDept;
      console.log('[OPPORTUNITIES][FACULTY_DEPT_SET]', {
        userId: req.user._id,
        email: req.user.email,
        department: facultyDept,
        departmentLength: facultyDept.length,
        departmentCharCodes: facultyDept.split('').map(c => c.charCodeAt(0))
      });
    }

    console.log('[OPPORTUNITIES][PRE_VALIDATION]', {
      department: payload.department,
      departmentLength: payload.department ? payload.department.length : 0,
      isValidDept: isValidOpportunityDepartment(payload.department),
      userRole: req.user.role
    });

    if (!isValidOpportunityDepartment(payload.department)) {
      const depts = payload.department.split(",").map(d => d.trim()).filter(Boolean);
      console.error('[OPPORTUNITIES][INVALID_DEPT]', {
        department: payload.department,
        parsedDepts: depts,
        isAdmin: req.user.role === "admin",
        isFaculty: req.user.role === "faculty",
        validDepartments: DEPARTMENTS
      });
      return fail(res, 400, "Invalid department value");
    }

    payload.status = deriveStatusFromLastDate(payload.lastDate);
    console.log(`[OPPORTUNITIES][STATUS_SET_CREATE]`, {
      lastDate: payload.lastDate?.toISOString().split("T")[0],
      statusSet: payload.status,
      source: "deriveStatusFromLastDate"
    });
    const validationError = validatePayload(payload);
    if (validationError) {
      console.error('[OPPORTUNITIES][VALIDATION_ERROR]', { payloadKeys: Object.keys(payload), error: validationError, department: payload.department });
      return fail(res, 400, validationError);
    }

    const opportunity = await Opportunity.create(payload);
    console.log('[OPPORTUNITIES][CREATED]', {
      id: opportunity._id,
      createdBy: req.user._id,
      department: payload.department,
      lastDate: opportunity.lastDate?.toISOString().split("T")[0],
      status: opportunity.status
    });
    return ok(res, normalizeOpportunity(opportunity), 201);
  } catch (error) {
    console.error("[OPPORTUNITIES][CREATE]", { body: req.body, userId: req.user._id, error: error.message });
    return fail(res, 400, "Failed to create opportunity", error.message);
  }
};

const updateOpportunity = async (req, res) => {
  try {
    console.log(`[OPPORTUNITIES][UPDATE_START]`, {
      opportunityId: req.params.id,
      userEmail: req.user.email,
      receivedLastDate: req.body.lastDate
    });

    const existing = await Opportunity.findById(req.params.id);
    if (!existing) return fail(res, 404, "Opportunity not found");

    if (!canFacultyEditOpportunityContent(req.user, existing)) {
      return fail(res, 403, "You don't have permission to edit this opportunity");
    }
    if (isArchivedOpportunity(existing)) {
      return fail(res, 409, "Cannot edit archived opportunities");
    }

    const normalizedLastDate = normalizeDateToStartOfDay(req.body.lastDate);
    const status = deriveStatusFromLastDate(normalizedLastDate);

    console.log(`[OPPORTUNITIES][UPDATE_DATE_PROCESSING]`, {
      opportunityId: req.params.id,
      previousLastDate: existing.lastDate?.toISOString().split("T")[0],
      newLastDate: req.body.lastDate,
      normalizedLastDate: normalizedLastDate?.toISOString().split("T")[0],
      newStatus: status
    });

    let academicFields;
    try {
      academicFields = parseAcademicEligibilityFields(req.body, existing);
    } catch (academicError) {
      return fail(res, 400, academicError.message);
    }

    const payload = {
      ...req.body,
      announcementHeading: sanitizeString(req.body.announcementHeading),
      description: sanitizeString(req.body.description),
      applicationLink: req.body.applicationLink ? sanitizeString(req.body.applicationLink) : "",
      department: sanitizeString(req.body.department),
      type: sanitizeString(req.body.type),
      eligibilityCriteria: Array.isArray(req.body.eligibilityCriteria)
        ? req.body.eligibilityCriteria.map(sanitizeString).filter(Boolean).join(", ")
        : sanitizeString(req.body.eligibilityCriteria),
      lastDate: normalizedLastDate,
      eligibleGenders: parseEligibleGenders(req.body.eligibleGenders ?? existing.eligibleGenders),
      ...academicFields,
    };

    // Faculty can only create opportunities for their own department
    if (req.user.role === "faculty") {
      if (!req.user.department || req.user.department.trim() === "") {
        console.error('[OPPORTUNITIES][FACULTY_NO_DEPT]', { userId: req.user._id, email: req.user.email, opportunityId: req.params.id });
        return fail(res, 400, "Your profile doesn't have a department assigned. Please contact admin.");
      }
      payload.department = req.user.department.trim();
      console.log('[OPPORTUNITIES][FACULTY_DEPT_SET_UPDATE]', { userId: req.user._id, opportunityId: req.params.id, department: payload.department });
    }

    if (!isValidOpportunityDepartment(payload.department)) {
      console.error('[OPPORTUNITIES][INVALID_DEPT_UPDATE]', { department: payload.department, opportunityId: req.params.id });
      return fail(res, 400, "Invalid department value");
    }

    payload.status = deriveStatusFromLastDate(payload.lastDate);
    console.log(`[OPPORTUNITIES][STATUS_SET_UPDATE]`, {
      opportunityId: req.params.id,
      previousStatus: existing.status,
      lastDate: payload.lastDate?.toISOString().split("T")[0],
      statusSet: payload.status,
      source: "deriveStatusFromLastDate"
    });
    const validationError = validatePayload(payload);
    if (validationError) {
      console.error('[OPPORTUNITIES][VALIDATION_ERROR_UPDATE]', { error: validationError, department: payload.department, opportunityId: req.params.id });
      return fail(res, 400, validationError);
    }

    const updated = await Opportunity.findByIdAndUpdate(req.params.id, payload, { returnDocument: "after" });
    console.log('[OPPORTUNITIES][UPDATED]', {
      id: req.params.id,
      updatedBy: req.user._id,
      department: payload.department,
      lastDate: updated.lastDate?.toISOString().split("T")[0],
      newStatus: updated.status
    });
    return ok(res, normalizeOpportunity(updated));
  } catch (error) {
    console.error("[OPPORTUNITIES][UPDATE]", { id: req.params.id, userId: req.user._id, error: error.message });
    return fail(res, 400, "Failed to update opportunity", error.message);
  }
};

const deleteOpportunity = async (req, res) => {
  try {
    const existing = await Opportunity.findById(req.params.id);
    if (!existing) return fail(res, 404, "Opportunity not found");
    if (!canFacultyDeleteOpportunity(req.user, existing)) return fail(res, 403, "You don't have permission to delete this opportunity");
    if (isArchivedOpportunity(existing)) return fail(res, 409, "Archived opportunities cannot be deleted");

    await Opportunity.deleteOne({ _id: existing._id });
    return ok(res, { message: "Opportunity deleted successfully" });
  } catch (error) {
    return fail(res, 500, "Failed to delete opportunity", error.message);
  }
};

const getActiveOpportunities = async (req, res) => {
  try {
    console.log(`[OPPORTUNITY ACTIVE][START]`, {
      userEmail: req.user.email,
      userRole: req.user.role
    });

    await syncOpportunityStatuses();
    const filter = { status: "active" };

    if (req.user.role === "faculty" || req.user.role === "student") {
      Object.assign(filter, buildDepartmentAudienceMatch(req.user.department));

      // Add year-based eligibility filtering for students
      if (req.user.role === "student" && req.user.year) {
        Object.assign(filter, buildYearEligibilityMatch(req.user.year));
        console.log(
          `[OPPORTUNITY ACTIVE] Fetching active opportunities for student ${req.user.email} (dept: ${req.user.department}, year: ${req.user.year})`
        );
      }
      if (req.user.role === "student" && req.user.gender) {
        Object.assign(filter, buildGenderEligibilityMatch(req.user.gender));
      } else {
        console.log(
          `[OPPORTUNITY ACTIVE] Fetching active opportunities for ${req.user.role} ${req.user.email} (dept: ${req.user.department})`
        );
      }
      if (req.user.role === "student") {
        Object.assign(filter, buildAcademicEligibilityMatch(req.user.academicInfo));
      }
    } else {
      console.log(`[OPPORTUNITY ACTIVE] Fetching active opportunities for ${req.user.role}: ${req.user.email}`);
    }

    const pipeline = [
      { $match: filter },
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "createdByUser"
        }
      },
      {
        $addFields: {
          createdByEmail: { $arrayElemAt: ["$createdByUser.email", 0] },
          createdByRole: { $arrayElemAt: ["$createdByUser.role", 0] },
          applicationCount: { $size: { $ifNull: ["$applications", []] } }
        }
      },
      {
        $project: {
          createdByUser: 0
        }
      },
      { $sort: { lastDate: 1, createdAt: -1 } }
    ];

    const data = await Opportunity.aggregate(pipeline);
    console.log(`[OPPORTUNITY ACTIVE][RESULTS]`, {
      found: data.length,
      userRole: req.user.role
    });

    // Log first few for debugging
    data.slice(0, 3).forEach(op => {
      const today = getTodayStart().toISOString().split("T")[0];
      console.log(`[OPPORTUNITY ACTIVE][ITEM]`, {
        id: op._id,
        heading: op.announcementHeading?.substring(0, 25),
        lastDate: op.lastDate?.toISOString().split("T")[0],
        today: today,
        status: op.status,
        createdName: op.createdName
      });
    });

    // Pass user email for students to check hasApplied status
    const userEmail = req.user.role === "student" ? req.user.email : null;
    return ok(res, data.map(doc => normalizeOpportunity(doc, userEmail)));
  } catch (error) {
    console.error(`[OPPORTUNITY ACTIVE][ERROR] getActiveOpportunities failed: ${error.message}`);
    return fail(res, 500, "Failed to fetch active opportunities", error.message);
  }
};

const getArchivedOpportunities = async (req, res) => {
  try {
    console.log(`[OPPORTUNITY ARCHIVED][START]`, {
      userEmail: req.user.email,
      userRole: req.user.role
    });

    await syncOpportunityStatuses();
    const filter = { status: "archived" };

    if (req.user.role === "faculty" || req.user.role === "student") {
      Object.assign(filter, buildDepartmentAudienceMatch(req.user.department));

      // Add year-based eligibility filtering for students
      if (req.user.role === "student" && req.user.year) {
        Object.assign(filter, buildYearEligibilityMatch(req.user.year));
        console.log(
          `[OPPORTUNITY ARCHIVED] Fetching archived opportunities for student ${req.user.email} (dept: ${req.user.department}, year: ${req.user.year})`
        );
      }
      if (req.user.role === "student" && req.user.gender) {
        Object.assign(filter, buildGenderEligibilityMatch(req.user.gender));
      } else {
        console.log(
          `[OPPORTUNITY ARCHIVED] Fetching archived opportunities for ${req.user.role} ${req.user.email} (dept: ${req.user.department})`
        );
      }
      if (req.user.role === "student") {
        Object.assign(filter, buildAcademicEligibilityMatch(req.user.academicInfo));
      }
    } else {
      console.log(`[OPPORTUNITY ARCHIVED] Fetching archived opportunities for ${req.user.role}: ${req.user.email}`);
    }

    const pipeline = [
      { $match: filter },
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "createdByUser"
        }
      },
      {
        $addFields: {
          createdByEmail: { $arrayElemAt: ["$createdByUser.email", 0] },
          createdByRole: { $arrayElemAt: ["$createdByUser.role", 0] },
          applicationCount: { $size: { $ifNull: ["$applications", []] } }
        }
      },
      {
        $project: {
          createdByUser: 0
        }
      },
      { $sort: { lastDate: -1, createdAt: -1 } }
    ];

    const data = await Opportunity.aggregate(pipeline);
    console.log(`[OPPORTUNITY ARCHIVED][RESULTS]`, {
      found: data.length,
      userRole: req.user.role
    });

    // Log first few for debugging
    data.slice(0, 3).forEach(op => {
      console.log(`[OPPORTUNITY ARCHIVED][ITEM]`, {
        id: op._id,
        heading: op.announcementHeading?.substring(0, 25),
        lastDate: op.lastDate?.toISOString().split("T")[0],
        status: op.status
      });
    });

    // Pass user email for students to check hasApplied status
    const userEmail = req.user.role === "student" ? req.user.email : null;
    return ok(res, data.map(doc => normalizeOpportunity(doc, userEmail)));
  } catch (error) {
    console.error(`[OPPORTUNITY ARCHIVED][ERROR] getArchivedOpportunities failed: ${error.message}`);
    return fail(res, 500, "Failed to fetch archived opportunities", error.message);
  }
};

const applyToOpportunity = async (req, res) => {
  try {
    if (req.user.role !== "student") {
      return fail(res, 403, "Faculty and Admin cannot apply for opportunities.");
    }

    const student = await User.findById(req.user._id);

    if (!student) {
      return fail(res, 404, "Student not found");
    }

    // Validate studentId
    if (!student.studentId) {
      return fail(res, 400, "Student ID is required. Please complete your profile.");
    }

    const opportunity = await Opportunity.findById(req.params.id);
    if (!opportunity) {
      return fail(res, 404, "Opportunity not found");
    }

    if (opportunity.status !== "active") {
      return fail(res, 400, "Cannot apply to inactive/archived opportunities");
    }

    if (!canViewOpportunityAsAudience(student, opportunity)) {
      return fail(res, 403, "You are not eligible for this opportunity");
    }

    // Check if already applied
    const alreadyApplied = opportunity.applications.some(app => app.studentEmail === req.user.email);
    if (alreadyApplied) {
      return fail(res, 400, "You have already applied to this opportunity");
    }

    // Prepare application data

    const studentName = (student.name || student.email || "Unknown").trim();
    const applicationData = {
      studentId: student.studentId,
      studentEmail: student.email,
      studentName: student.name,
      studentDepartment: student.department || "Not specified",
      studentYear: student.year || "Not specified",
      studentPhone: student.phone || "Not provided",
      studentsscPercentage: student.academicInfo?.sscPercentage ?? null,
      studentHscPercentage: student.academicInfo?.hscPercentage ?? null,
      studentCgpa: student.academicInfo?.cgpa ?? null,
      studenttechnicalSkills: student.technicalSkills || [],
      appliedAt: new Date(),
    };
    console.log("Application Data:", applicationData);
    // Add application
    opportunity.applications.push(applicationData);

    const updatedOpportunity = await opportunity.save();

    // Only seed first-round attendance on apply — never all activeStages (prevents
    // late applicants from receiving pending rows for future rounds they never entered).
    const applyStage =
      opportunity.activeStages?.includes("Aptitude Test")
        ? "Aptitude Test"
        : opportunity.activeStages?.[0] || null;

    if (applyStage) {
      const attendanceRecords = [
        {
          opportunityId: opportunity._id,
          studentId: req.user.studentId,
          stage: applyStage,
          status: "pending",
          markedBy: null,
          markedAt: null,
        },
      ];

      try {
        await OpportunityAttendance.insertMany(attendanceRecords, { ordered: false });
        console.log(`[APPLY] Created ${attendanceRecords.length} attendance records for student ${req.user.studentId}`);
      } catch (error) {
        // Duplicate errors (E11000) are expected if records already exist
        if (!error.message.includes("duplicate") && !error.message.includes("E11000")) {
          console.error("[APPLY ATTENDANCE ERROR]", { studentId: req.user.studentId, error: error.message });
        }
      }
    }

    return ok(res, normalizeOpportunity(updatedOpportunity));
  } catch (error) {
    console.error('[APPLY_ERROR]', { message: error.message, stack: error.stack });
    return fail(res, 500, "Failed to apply to opportunity", error.message);
  }
};

const getApplicantsCount = async (req, res) => {
  try {
    const opportunity = await Opportunity.findById(req.params.id);
    if (!opportunity) return fail(res, 404, "Opportunity not found");

    if (req.user.role === "faculty" && !canFacultyCollaborateOnOpportunity(req.user, opportunity)) {
      return fail(res, 403, "Access denied.");
    }

    const count = opportunity.applications.length;
    return ok(res, { opportunityId: opportunity._id, count });
  } catch (error) {
    return fail(res, 500, "Failed to fetch applicant count", error.message);
  }
};

const enrichApplicantFromUser = (app, userMap) => {
  const user = userMap.get(app.studentId) || {};
  const resumePath = user.resume?.filePath || user.resume?.resumeUrl || "";
  const hasResume = Boolean(resumePath && String(resumePath).trim());
  return {
    _id: app._id,
    appliedAt: app.appliedAt,
    student: {
      name: app.studentName || user.fullName || user.name,
      fullName: user.fullName || user.name || app.studentName || "",
      email: app.studentEmail || user.email,
      personalGmail: user.personalGmail || "",
      studentId: app.studentId || user.studentId,
      department: app.studentDepartment || user.department,
      division: user.division || "",
      year: app.studentYear || user.year,
      phone: app.studentPhone || user.phone,
      gender: user.gender || "",
      sscPercentage: app.studentsscPercentage ?? user.academicInfo?.sscPercentage ?? "",
      hscPercentage: app.studentHscPercentage ?? user.academicInfo?.hscPercentage ?? "",
      cgpa: app.studentCgpa ?? user.academicInfo?.cgpa ?? "",
      technicalSkills: app.studenttechnicalSkills?.length
        ? app.studenttechnicalSkills
        : user.technicalSkills || [],
      hasResume,
      resumeFileName: user.resume?.fileName || null,
    },
  };
};

const resolveResumeAbsolutePath = (resume) => {
  const rel = resume?.filePath || resume?.resumeUrl;
  if (!rel || !String(rel).trim() || String(rel).startsWith("http")) return null;
  const absolutePath = path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
  return fs.existsSync(absolutePath) ? absolutePath : null;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseEmailList = (value) => {
  if (!value || !String(value).trim()) return [];
  return String(value)
    .split(/[,;]/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
};

const validateEmailList = (emails, label) => {
  for (const email of emails) {
    if (!EMAIL_REGEX.test(email)) {
      return `${label} contains an invalid email address: ${email}`;
    }
  }
  return null;
};

const buildApplicantsPayload = async (opportunity) => {
  const studentIds = (opportunity.applications || []).map((app) => app.studentId).filter(Boolean);
  const users = studentIds.length
    ? await User.find({ studentId: { $in: studentIds } })
        .select("studentId name fullName email personalGmail department division year phone gender academicInfo technicalSkills resume")
        .lean()
    : [];
  const userMap = new Map(users.map((u) => [u.studentId, u]));
  const applicants = (opportunity.applications || []).map((app) => enrichApplicantFromUser(app, userMap));
  return sortApplicantsAlphabetically(applicants);
};

const getApplicants = async (req, res) => {
  try {
    const opportunity = await Opportunity.findById(req.params.id);
    if (!opportunity) return fail(res, 404, "Opportunity not found");

    if (req.user.role === "faculty" && !canFacultyCollaborateOnOpportunity(req.user, opportunity)) {
      return fail(res, 403, "Access denied.");
    }

    const applicants = await buildApplicantsPayload(opportunity);

    return ok(res, applicants);
  } catch (error) {
    return fail(res, 500, "Failed to fetch applicants", error.message);
  }
};

const getOpportunityApplications = async (req, res) => {
  try {
    const opportunity = await Opportunity.findById(req.params.id);

    if (!opportunity) return fail(res, 404, "Opportunity not found");

    if (req.user.role !== "admin" && !canFacultyCollaborateOnOpportunity(req.user, opportunity)) {
      return fail(res, 403, "You don't have permission to view applications");
    }

    const applications = opportunity.applications.map(app => ({
      ...app.toObject(),
      studentName: app.studentName,
      count: opportunity.applications.length
    }));

    return ok(res, {
      applications,
      count: applications.length,
      opportunityId: opportunity._id
    });
  } catch (error) {
    return fail(res, 500, "Failed to fetch applications", error.message);
  }
};

/**
 * Save manual student selections for a specific stage
 * POST /api/opportunity/:opportunityId/stage/:stage/selections
 * Body: { selectedStudentIds: ["studentId1", "studentId2", ...] }
 * Faculty/Admin can select students for their/all opportunities
 */
const saveStageSelections = async (req, res) => {
  try {
    const { opportunityId, stage } = req.params;
    const { selectedStudentIds } = req.body;

    // Validate inputs
    if (!opportunityId || !mongoose.Types.ObjectId.isValid(opportunityId)) {
      return fail(res, 400, "Invalid opportunity ID");
    }

    const validStages = [
      "Aptitude Test",
      "Group Discussion",
      "Technical Interview",
      "HR Interview",
      "Result",
    ];
    if (!stage || !validStages.includes(stage)) {
      return fail(res, 400, `Invalid stage. Must be one of: ${validStages.join(", ")}`);
    }

    if (!Array.isArray(selectedStudentIds)) {
      return fail(res, 400, "selectedStudentIds must be an array");
    }

    // Fetch opportunity
    const opportunity = await Opportunity.findById(opportunityId);
    if (!opportunity) {
      return fail(res, 404, "Opportunity not found");
    }

    if (req.user.role === "faculty" && !canFacultyCollaborateOnOpportunity(req.user, opportunity)) {
      return fail(res, 403, "You can only manage selections for opportunities in your department");
    }

    // Sanitize student IDs
    const sanitizedIds = selectedStudentIds
      .map(id => sanitizeString(String(id)).trim())
      .filter(Boolean);

    // Find existing stage selection or create new one
    let stageSelection = opportunity.stageManualSelections?.find(
      (s) => s.stage === stage
    );

    if (stageSelection) {
      // Update existing
      stageSelection.selectedStudentIds = sanitizedIds;
      stageSelection.selectedAt = new Date();
      stageSelection.selectedBy = req.user._id;
    } else {
      // Create new
      opportunity.stageManualSelections = opportunity.stageManualSelections || [];
      opportunity.stageManualSelections.push({
        stage,
        selectedStudentIds: sanitizedIds,
        selectedAt: new Date(),
        selectedBy: req.user._id,
      });
    }

    // Save to database
    const updatedOpportunity = await opportunity.save();

    console.log(`[OPPORTUNITY SELECTIONS][${req.user.role.toUpperCase()}]`, {
      opportunityId: updatedOpportunity._id,
      stage,
      selectedCount: sanitizedIds.length,
      userId: req.user._id,
      email: req.user.email,
    });

    return ok(res, {
      opportunityId: updatedOpportunity._id,
      stage,
      selectedStudentIds: sanitizedIds,
      selectedAt: new Date(),
      message: `Successfully saved ${sanitizedIds.length} student(s) for ${stage}`,
    });
  } catch (error) {
    console.error("[SAVE STAGE SELECTIONS ERROR]", error);
    return fail(res, 500, "Failed to save student selections", error.message);
  }
};

/**
 * Get manual student selections for a specific stage
 * GET /api/opportunity/:opportunityId/stage/:stage/selections
 */
const getStageSelections = async (req, res) => {
  try {
    const { opportunityId, stage } = req.params;

    // Validate inputs
    if (!opportunityId || !mongoose.Types.ObjectId.isValid(opportunityId)) {
      return fail(res, 400, "Invalid opportunity ID");
    }

    const validStages = [
      "Aptitude Test",
      "Group Discussion",
      "Technical Interview",
      "HR Interview",
      "Result",
    ];
    if (!stage || !validStages.includes(stage)) {
      return fail(res, 400, `Invalid stage. Must be one of: ${validStages.join(", ")}`);
    }

    // Fetch opportunity
    const opportunity = await Opportunity.findById(opportunityId)
      .select("stageManualSelections selectedStudents department createdBy")
      .lean();
    if (!opportunity) {
      return fail(res, 404, "Opportunity not found");
    }

    if (req.user.role === "faculty" && !canFacultyCollaborateOnOpportunity(req.user, opportunity)) {
      return fail(res, 403, "You can only view selections for opportunities in your department");
    }

    // Find stage selection
    const stageSelection = opportunity.stageManualSelections?.find(
      (s) => s.stage === stage
    );

    return ok(res, {
      opportunityId,
      stage,
      selectedStudentIds: stageSelection?.selectedStudentIds || [],
      selectedAt: stageSelection?.selectedAt || null,
      selectedBy: stageSelection?.selectedBy || null,
    });
  } catch (error) {
    console.error("[GET STAGE SELECTIONS ERROR]", error);
    return fail(res, 500, "Failed to fetch student selections", error.message);
  }
};

/**
 * Download applicants list as CSV
 * Accessible by admin and faculty collaborators
 */
const downloadApplicants = async (req, res) => {
  try {
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 400, "Invalid opportunity ID format");
    }

    const opportunity = await Opportunity.findById(req.params.id);
    if (!opportunity) {
      return fail(res, 404, "Opportunity not found");
    }

    // Check faculty authorization
    if (req.user.role === "faculty" && !canFacultyCollaborateOnOpportunity(req.user, opportunity)) {
      return fail(res, 403, "Access denied. You can only download applicants for opportunities you created or collaborate on.");
    }

    // Prepare applicants data with live user fields and round progress
    const applicants = await buildApplicantsPayload(opportunity);
    const attendanceRecords = await OpportunityAttendance.find({ opportunityId: opportunity._id }).lean();
    const attendanceMap = buildAttendanceMap(attendanceRecords);

    const applicantsWithRounds = applicants.map((applicant) => {
      const studentId = applicant.student?.studentId;
      const rounds = {};
      for (const stage of RECRUITMENT_STAGE_ORDER) {
        rounds[stage] = getRoundCsvLabel(opportunity, studentId, stage, attendanceMap, attendanceRecords);
      }
      return { ...applicant, rounds };
    });

    // Generate CSV
    const csvContent = generateApplicantsCSV(applicantsWithRounds, opportunity.announcementHeading);
    const filename = generateApplicantsFilename(opportunity.announcementHeading);

    // Set response headers for file download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    return res.send(csvContent);
  } catch (error) {
    console.error("[DOWNLOAD APPLICANTS ERROR]", error);
    return fail(res, 500, "Failed to download applicants", error.message);
  }
};

/**
 * Download all applicant resumes as a ZIP (admin only)
 * GET /api/opportunities/:id/applicants/resumes/download
 */
const downloadAllApplicantResumes = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 400, "Invalid opportunity ID format");
    }

    const opportunity = await Opportunity.findById(req.params.id);
    if (!opportunity) {
      return fail(res, 404, "Opportunity not found");
    }

    const studentIds = (opportunity.applications || []).map((app) => app.studentId).filter(Boolean);
    if (studentIds.length === 0) {
      return fail(res, 404, "No applicants found for this opportunity");
    }

    const users = await User.find({ studentId: { $in: studentIds } })
      .select("studentId name fullName resume")
      .lean();

    const resumeEntries = users
      .map((user) => {
        const absolutePath = resolveResumeAbsolutePath(user.resume);
        if (!absolutePath) return null;
        const ext = path.extname(absolutePath) || path.extname(user.resume?.fileName || "") || ".pdf";
        const displayName = sanitizeFilenameForOS(user.fullName || user.name || user.studentId);
        return {
          absolutePath,
          entryName: `${displayName}_${user.studentId}${ext}`,
        };
      })
      .filter(Boolean);

    if (resumeEntries.length === 0) {
      return fail(res, 404, "No resumes available for download");
    }

    const filename = generateResumesZipFilename(opportunity.announcementHeading);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-cache");

    const archive = archiver("zip", { zlib: { level: 5 } });
    archive.on("error", (err) => {
      console.error("[DOWNLOAD ALL RESUMES ERROR]", err);
      if (!res.headersSent) {
        fail(res, 500, "Failed to create resume ZIP", err.message);
      }
    });

    archive.pipe(res);

    for (const entry of resumeEntries) {
      archive.file(entry.absolutePath, { name: entry.entryName });
    }

    await archive.finalize();
  } catch (error) {
    console.error("[DOWNLOAD ALL RESUMES ERROR]", error);
    if (!res.headersSent) {
      return fail(res, 500, "Failed to download resumes", error.message);
    }
  }
};

/**
 * Send email with attachments for opportunity applicants (admin only)
 * POST /api/opportunities/:id/applicants/email
 */
const sendApplicantEmail = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return fail(res, 400, "Invalid opportunity ID format");
    }

    const opportunity = await Opportunity.findById(req.params.id).select("announcementHeading");
    if (!opportunity) {
      return fail(res, 404, "Opportunity not found");
    }

    const to = sanitizeString(req.body.to || "").trim().toLowerCase();
    const ccList = parseEmailList(req.body.cc);
    const bccList = parseEmailList(req.body.bcc);
    const subject = sanitizeString(req.body.subject || "").trim();
    const message = sanitizeString(req.body.message || "").trim();

    if (!to) {
      return fail(res, 400, "Receiver email is required");
    }
    if (!EMAIL_REGEX.test(to)) {
      return fail(res, 400, "Receiver email is invalid");
    }

    const ccError = validateEmailList(ccList, "CC");
    if (ccError) return fail(res, 400, ccError);

    const bccError = validateEmailList(bccList, "BCC");
    if (bccError) return fail(res, 400, bccError);

    if (!subject) {
      return fail(res, 400, "Subject is required");
    }
    if (!message) {
      return fail(res, 400, "Message is required");
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return fail(res, 400, "At least one attachment is required");
    }

    const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;
    const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
    if (totalSize > MAX_ATTACHMENT_SIZE) {
      return fail(res, 400, "Total attachment size exceeds the 25MB limit");
    }

    const attachments = files.map((file) => ({
      filename: file.originalname || "attachment",
      content: file.buffer,
      contentType: file.mimetype,
    }));

    await sendEmail({
      to,
      cc: ccList.length > 0 ? ccList.join(", ") : undefined,
      bcc: bccList.length > 0 ? bccList.join(", ") : undefined,
      subject,
      text: message,
      attachments,
    });

    console.log(`[APPLICANT EMAIL] Sent by ${req.user.email} for opportunity ${opportunity.announcementHeading}`);

    return ok(res, { message: "Email sent successfully" });
  } catch (error) {
    console.error("[SEND APPLICANT EMAIL ERROR]", error);
    const message =
      error.message?.includes("credentials") || error.message?.includes("Email")
        ? "Email service is not configured. Please contact the administrator."
        : "Failed to send email. Please try again.";
    return fail(res, 500, message, error.message);
  }
};

module.exports = {
  listOpportunities,
  getOpportunityById,
  createOpportunity,
  updateOpportunity,
  deleteOpportunity,
  getActiveOpportunities,
  getArchivedOpportunities,
  applyToOpportunity,
  getApplicantsCount,
  getApplicants,
  downloadApplicants,
  downloadAllApplicantResumes,
  sendApplicantEmail,
  getOpportunityApplications,
  saveStageSelections,
  getStageSelections,
};
