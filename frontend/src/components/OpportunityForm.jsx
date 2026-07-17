import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { PrimaryButton } from "./ui";
import { DEPARTMENTS, OPPORTUNITY_BROADCAST_ALL, YEAR_OPTIONS, GENDER_OPTIONS } from "../constants/departments";
import SKILLS_BY_DEPARTMENT from "../constants/skillsByDepartment";

const departmentOptions = DEPARTMENTS;

const parseToArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    if (!value.trim()) return [];
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const OpportunityForm = ({
  value,
  onChange,
  onSubmit,
  submitLabel = "Submit",
  showDepartment = true,
  departmentLocked = false,
  loading = false,
  isEditing = false,
  onCancelEdit,
}) => {
  const today = new Date().toISOString().split("T")[0];
  const [showDepartmentPanel, setShowDepartmentPanel] = useState(false);
  const [showEligibilityPanel, setShowEligibilityPanel] = useState(false);
  const [customSkill, setCustomSkill] = useState("");
  const departmentRef = useRef(null);
  const eligibilityRef = useRef(null);

  const selectedDepartments = useMemo(() => {
    if (value.department === OPPORTUNITY_BROADCAST_ALL) return [...departmentOptions];
    return parseToArray(value.department);
  }, [value.department]);

  const availableSkills = useMemo(() => {
    if (value.department === OPPORTUNITY_BROADCAST_ALL) {
      const allSkills = new Set();
      DEPARTMENTS.forEach((dept) => {
        const deptSkills = SKILLS_BY_DEPARTMENT[dept] || [];
        deptSkills.forEach((skill) => allSkills.add(skill));
      });
      return Array.from(allSkills).sort();
    }
    const depts = parseToArray(value.department);
    const allSkills = new Set();
    depts.forEach((dept) => {
      const deptSkills = SKILLS_BY_DEPARTMENT[dept] || [];
      deptSkills.forEach((skill) => allSkills.add(skill));
    });
    return Array.from(allSkills).sort();
  }, [value.department]);

  const selectedSkills = useMemo(() => {
    return Array.isArray(value.technicalSkills) ? value.technicalSkills : [];
  }, [value.technicalSkills]);

  const selectedYears = useMemo(() => parseToArray(value.eligibilityCriteria), [value.eligibilityCriteria]);
  const selectedGenders = useMemo(() => {
    const raw = value.eligibleGenders;
    if (Array.isArray(raw) && raw.length > 0) return raw;
    return [...GENDER_OPTIONS];
  }, [value.eligibleGenders]);

  useEffect(() => {
    const handler = (event) => {
      if (departmentRef.current && !departmentRef.current.contains(event.target)) setShowDepartmentPanel(false);
      if (eligibilityRef.current && !eligibilityRef.current.contains(event.target)) setShowEligibilityPanel(false);
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pushNext = (nextValue) => onChange({ ...value, ...nextValue });

  const toggleDepartment = (dept) => {
    if (departmentLocked) return;

    let next;
    if (value.department === OPPORTUNITY_BROADCAST_ALL) {
      next = [dept];
    } else {
      const current = parseToArray(value.department);
      const has = current.includes(dept);
      next = has ? current.filter((item) => item !== dept) : [...current, dept];
    }

    if (next.length === departmentOptions.length) {
      pushNext({ department: OPPORTUNITY_BROADCAST_ALL });
    } else {
      pushNext({ department: next.join(", ") });
    }
  };

  const toggleAllDepartments = () => pushNext({ department: OPPORTUNITY_BROADCAST_ALL });

  const toggleEligibility = (year) => {
    const has = selectedYears.includes(year);
    const next = has ? selectedYears.filter((item) => item !== year) : [...selectedYears, year];
    pushNext({ eligibilityCriteria: next });
  };

  const toggleGenderEligibility = (gender) => {
    const has = selectedGenders.includes(gender);
    const next = has ? selectedGenders.filter((item) => item !== gender) : [...selectedGenders, gender];
    if (next.length === 0) return;
    pushNext({ eligibleGenders: next });
  };

  const handleRemoveSkill = (skill) => {
    const next = selectedSkills.filter((item) => item !== skill);
    pushNext({ technicalSkills: next });
  };

  const handleAddCustomSkill = () => {
    if (customSkill.trim() && !selectedSkills.includes(customSkill.trim())) {
      const next = [...selectedSkills, customSkill.trim()];
      pushNext({ technicalSkills: next });
      setCustomSkill("");
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.();
  };

  const departmentText =
    value.department === OPPORTUNITY_BROADCAST_ALL ? "Broadcast to All Departments" : `${selectedDepartments.length} selected`;

  return (
    <form onSubmit={handleSubmit} className="glass-panel space-y-4 sm:space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="border-b border-slate-200/80 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h3 className="text-lg sm:text-xl font-semibold text-slate-800">
            {isEditing ? "Edit Opportunity Details" : "Post New Opportunity"}
          </h3>
          <span className="rounded-full border border-red-200/80 bg-red-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700 whitespace-nowrap w-fit">
            Faculty Form
          </span>
        </div>
      </div>

      {/* Main Grid - 2 columns on md+, 1 on smaller screens */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 lg:gap-6">
        {/* Full Width - Heading */}
        <div className="md:col-span-2">
          <label className="block">
            <span className="label-modern text-sm">Announcement Heading</span>
            <input
              className="input-modern"
              placeholder="SDE Internship Drive - 2026"
              value={value.announcementHeading || ""}
              onChange={(event) => pushNext({ announcementHeading: event.target.value })}
              required
              aria-label="Announcement heading"
            />
          </label>
        </div>

        {/* Opportunity Type */}
        <label>
          <span className="label-modern text-sm">Opportunity Type</span>
          <select
            className="input-modern"
            value={value.type || "Internship"}
            onChange={(event) => pushNext({ type: event.target.value })}
            aria-label="Opportunity type"
          >
            <option value="Internship">Internship</option>
            <option value="Placement">Placement</option>
          </select>
        </label>

        {/* Department */}
        {showDepartment ? (
          <div ref={departmentRef} className="relative">
            <span className="label-modern text-sm">Department</span>
            <button
              type="button"
              disabled={departmentLocked}
              onClick={() => setShowDepartmentPanel((open) => !open)}
              className="input-modern flex items-center justify-between text-left disabled:cursor-not-allowed disabled:bg-slate-100"
              aria-haspopup="listbox"
              aria-expanded={showDepartmentPanel}
              aria-label="Department selector"
            >
              <span className="truncate text-sm">{departmentText}</span>
              <ChevronDown size={18} className={`transition flex-shrink-0 ${showDepartmentPanel ? "rotate-180" : ""}`} />
            </button>

            {showDepartmentPanel ? (
              <div className="glass-panel absolute z-20 mt-2 w-full space-y-2 p-3 max-h-64 overflow-y-auto left-0 right-0">
                {!departmentLocked && (
                  <button
                    type="button"
                    onClick={toggleAllDepartments}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-red-50"
                  >
                    <input
                      type="checkbox"
                      checked={value.department === OPPORTUNITY_BROADCAST_ALL}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleAllDepartments();
                      }}
                      className="w-4 h-4"
                    />
                    <span>Broadcast to All Departments</span>
                  </button>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-200">
                  {departmentOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => toggleDepartment(option)}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-red-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDepartments.includes(option)}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleDepartment(option);
                        }}
                        className="w-4 h-4"
                      />
                      <span className="truncate">{option}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Eligibility Criteria */}
        <div ref={eligibilityRef} className="relative">
          <span className="label-modern text-sm">Eligibility Criteria</span>
          <button
            type="button"
            onClick={() => setShowEligibilityPanel((open) => !open)}
            className="input-modern flex items-center justify-between text-left"
            aria-haspopup="listbox"
            aria-expanded={showEligibilityPanel}
            aria-label="Eligibility year selector"
          >
            <span className="truncate text-sm">{selectedYears.length ? `${selectedYears.length} selected` : "Select eligible years"}</span>
            <ChevronDown size={18} className={`transition flex-shrink-0 ${showEligibilityPanel ? "rotate-180" : ""}`} />
          </button>

          {showEligibilityPanel ? (
            <div className="glass-panel absolute z-20 mt-2 w-full p-3 left-0 right-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {YEAR_OPTIONS.map((year) => (
                  <button
                    key={year}
                    type="button"
                    onClick={() => toggleEligibility(year)}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-red-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedYears.includes(year)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleEligibility(year);
                      }}
                      className="w-4 h-4"
                    />
                    <span className="truncate text-xs sm:text-sm">{year}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Internal gender eligibility — not shown on opportunity cards */}
        <div className="md:col-span-2">
          <span className="label-modern text-sm">Select Gender</span>
          {/* <p className="text-xs text-slate-500 mb-2">Used only for backend eligibility filtering when students browse opportunities.</p> */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {GENDER_OPTIONS.map((gender) => (
              <label key={gender} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedGenders.includes(gender)}
                  onChange={() => toggleGenderEligibility(gender)}
                  className="w-4 h-4"
                />
                <span>{gender}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Academic eligibility minima */}
        <fieldset className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
          <legend className="sr-only">Academic eligibility criteria</legend>
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">Academic Eligibility Criteria</p>
              {/* <p className="mt-1 text-xs leading-5 text-slate-500">
                Set the minimum scores required to view this opportunity.
              </p> */}
            </div>
            <span className="mt-1 w-fit rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 sm:mt-0">
              Optional
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="label-modern text-sm">SSC Percentage</span>
              <input
                type="number"
                className="input-modern"
                min={0}
                max={100}
                step="0.01"
                placeholder="75"
                value={value.sscPercentage ?? ""}
                onChange={(event) => pushNext({ sscPercentage: event.target.value })}
                aria-label="Minimum SSC percentage"
              />
              {/* <span className="mt-1.5 block text-xs text-slate-500">Allowed range: 0–100</span> */}
            </label>

            <label className="block">
              <span className="label-modern text-sm">HSC Percentage</span>
              <input
                type="number"
                className="input-modern"
                min={0}
                max={100}
                step="0.01"
                placeholder="70"
                value={value.hscPercentage ?? ""}
                onChange={(event) => pushNext({ hscPercentage: event.target.value })}
                aria-label="Minimum HSC percentage"
              />
              {/* <span className="mt-1.5 block text-xs text-slate-500">Allowed range: 0–100</span> */}
            </label>

            <label className="block">
              <span className="label-modern text-sm">CGPA</span>
              <input
                type="number"
                className="input-modern"
                min={0}
                max={10}
                step="0.01"
                placeholder="8.25"
                value={value.cgpa ?? ""}
                onChange={(event) => pushNext({ cgpa: event.target.value })}
                aria-label="Minimum CGPA"
              />
              {/* <span className="mt-1.5 block text-xs text-slate-500">Allowed range: 0–10</span> */}
            </label>
          </div>

          {/* <p className="mt-4 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-500">
            Blank fields are not considered when checking student eligibility.
          </p> */}
        </fieldset>

        {/* Last Date */}
        <label>
          <span className="label-modern text-sm">Application Deadline</span>
          <input
            type="date"
            className="input-modern"
            value={value.lastDate || ""}
            min={today}
            onChange={(event) => pushNext({ lastDate: event.target.value })}
            required
            aria-label="Application last date"
          />
        </label>

        {/* Full Width - Description */}
        <div className="md:col-span-2">
          <label className="block">
            <span className="label-modern text-sm">Description</span>
            <textarea
              rows={5}
              maxLength={10000}
              className="input-modern resize-y"
              placeholder="Share role details, hiring process, requirements, and important notes."
              value={value.description || ""}
              onChange={(event) => pushNext({ description: event.target.value })}
              required
              aria-label="Opportunity description"
            />
          </label>
        </div>

        {/* Full Width - Technical Skills */}
        <div className="md:col-span-2">
          <span className="label-modern text-sm mb-3 block">Skills (Optional)</span>

          {/* Skill Input */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={customSkill}
              onChange={(e) => setCustomSkill(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCustomSkill();
                }
              }}
              placeholder="e.g., Docker, React, Node.js"
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder-slate-500 transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 min-w-0"
              aria-label="Custom skill input"
            />
            <button
              type="button"
              onClick={handleAddCustomSkill}
              className="rounded-lg bg-red-600 px-4 py-2.5 text-white transition hover:bg-red-700 active:bg-red-800 font-medium text-sm flex-shrink-0"
              aria-label="Add skill"
            >
              <Plus size={18} />
            </button>
          </div>

          {/* Selected Skills - Responsive Grid */}
          {selectedSkills.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedSkills.map((skill) => (
                <div
                  key={skill}
                  className="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-3 py-1.5 text-sm text-indigo-700 border border-indigo-200"
                >
                  <span>{skill}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveSkill(skill)}
                    className="ml-1 transition hover:text-indigo-900 focus:outline-none flex-shrink-0"
                    aria-label={`Remove skill: ${skill}`}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons - Full Width */}
      <div className="border-t border-slate-200/80 pt-4 sm:pt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 gap-4">
        <PrimaryButton type="submit" loading={loading} disabled={loading} className="sm:col-span-2 md:col-span-1">
          {submitLabel}
        </PrimaryButton>
        {isEditing && onCancelEdit ? (
          <button
            type="button"
            onClick={onCancelEdit}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600 sm:col-span-2 md:col-span-1"
          >
            Cancel Edit
          </button>
        ) : null}
      </div>
    </form>
  );
};

export default OpportunityForm;
