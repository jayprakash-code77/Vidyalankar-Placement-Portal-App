import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import Layout from "../components/Layout";
import Footer from "../components/Footer";
import OpportunityCard from "../components/OpportunityCard";
import OpportunityForm from "../components/OpportunityForm";
import { EmptyState, SectionTitle, Spinner, StatusMessage } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { getAccessToken } from "../api";
import {
  createOpportunity,
  deleteOpportunity,
  getOpportunities,
  getOpportunityById,
  updateOpportunity,
} from "../services/opportunitiesService";
import { facultyCanCollaborateOnOpportunity, facultyCanDeleteOpportunity } from "../utils/opportunityDepartment";

const LAST_DEPARTMENT_KEY = "lastDepartment";

import { GENDER_OPTIONS } from "../constants/departments";

const getInitialForm = (facultyDepartment) => ({
  announcementHeading: "",
  type: "Internship",
  description: "",
  eligibilityCriteria: [],
  eligibleGenders: [...GENDER_OPTIONS],
  sscPercentage: "",
  hscPercentage: "",
  cgpa: "",
  lastDate: "",
  department: facultyDepartment || "",
  technicalSkills: [],
  applicationLink: "",
});

const normalizeToForm = (item) => ({
  announcementHeading: item.announcementHeading || "",
  type: item.type || "Internship",
  description: item.description || "",
  eligibilityCriteria: (item.eligibilityCriteria || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
  lastDate: item.lastDate ? new Date(item.lastDate).toISOString().slice(0, 10) : "",
  department: item.department || "",
  technicalSkills: Array.isArray(item.technicalSkills) ? item.technicalSkills : [],
  applicationLink: item.applicationLink || "",
  eligibleGenders: Array.isArray(item.eligibleGenders) && item.eligibleGenders.length > 0
    ? item.eligibleGenders
    : [...GENDER_OPTIONS],
  sscPercentage: item.sscPercentage ?? "",
  hscPercentage: item.hscPercentage ?? "",
  cgpa: item.cgpa ?? "",
});

const isArchived = (item) => {
  const lastMidnight = new Date(item.lastDate);
  lastMidnight.setHours(0, 0, 0, 0);
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  return todayMidnight > lastMidnight;
};

const canFacultyEditOpportunity = (opportunity, user) =>
  user?.role === "admin" ||
  (user?.role === "faculty" && facultyCanCollaborateOnOpportunity(user, opportunity));

const isValidHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const FacultyOpportunitiesPage = () => {
  const { user, isHydrated, token } = useAuth();
  const [form, setForm] = useState(() => getInitialForm(user?.department));
  const [editingId, setEditingId] = useState(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

  // Sync form department when user department loads
  useEffect(() => {
    if (user?.department && !editingId) {
      setForm((prevForm) => ({
        ...prevForm,
        department: user.department,
      }));
    }
  }, [user?.department, editingId]);

  const loadOpportunities = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getOpportunities();
      setOpportunities(data || []);
    } catch (loadError) {
      setError(loadError.message || "Failed to load opportunities");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (!token && !getAccessToken()) return;
    loadOpportunities();
  }, [isHydrated, token, loadOpportunities]);

  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId) return;
    const fetchAndPrefill = async () => {
      try {
        toast("Editing opportunity...");
        const data = await getOpportunityById(editId);
        if (isArchived(data)) {
          setError("Cannot edit archived opportunities");
          toast.error("Cannot edit archived opportunities");
          setSearchParams({});
          return;
        }
        setEditingId(data.id || data._id);
        setForm(normalizeToForm(data));
        setSelectedOpportunity(data);
      } catch (fetchError) {
        setError(fetchError.message);
        toast.error(fetchError.message);
        setSearchParams({});
      }
    };
    fetchAndPrefill();
  }, [searchParams, setSearchParams]);

  const resetForm = () => {
    setForm(getInitialForm(user?.department));
    setEditingId(null);
    setSelectedOpportunity(null);
    setSearchParams({});
  };

  const validateForm = () => {
    const trimmedHeading = form.announcementHeading.trim();
    const trimmedDescription = form.description.trim();
    const selectedDate = new Date(form.lastDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    selectedDate.setHours(0, 0, 0, 0);

    const hasEligibility = Array.isArray(form.eligibilityCriteria)
      ? form.eligibilityCriteria.length > 0
      : Boolean(form.eligibilityCriteria?.trim?.());

    if (!trimmedHeading || !form.type || !trimmedDescription || !form.lastDate || !hasEligibility) {
      return "Please fill all required fields (including eligibility criteria)";
    }
    if (trimmedDescription.length > 10000) {
      return "Description must be less than 10000 characters";
    }
    if (selectedDate < today) {
      return "Last date cannot be in the past";
    }
    if (!form.department || form.department.trim() === "") {
      return "Department is required. Please ensure your profile has a department assigned.";
    }

    const toOptionalNumber = (value, min, max, label) => {
      if (value === undefined || value === null || value === "") return "";
      const n = Number(value);
      if (Number.isNaN(n)) return `${label} must be a number`;
      if (n < min || n > max) return `${label} must be between ${min} and ${max}`;
      return "";
    };
    return (
      toOptionalNumber(form.sscPercentage, 0, 100, "SSC percentage") ||
      toOptionalNumber(form.hscPercentage, 0, 100, "HSC percentage") ||
      toOptionalNumber(form.cgpa, 0, 10, "CGPA") ||
      ""
    );
  };

  const buildPayload = () => {
    const payload = {
      ...form,
      announcementHeading: form.announcementHeading.trim(),
      description: form.description.trim(),
      department: form.department.trim(),
      applicationLink: form.applicationLink || "",
      eligibilityCriteria: Array.isArray(form.eligibilityCriteria)
        ? form.eligibilityCriteria.filter(Boolean).join(", ")
        : (form.eligibilityCriteria || "").trim(),
      eligibleYears: Array.isArray(form.eligibilityCriteria)
        ? form.eligibilityCriteria.filter(Boolean)
        : [],
      eligibleGenders: Array.isArray(form.eligibleGenders) ? form.eligibleGenders : [...GENDER_OPTIONS],
      sscPercentage: form.sscPercentage === "" || form.sscPercentage == null ? null : Number(form.sscPercentage),
      hscPercentage: form.hscPercentage === "" || form.hscPercentage == null ? null : Number(form.hscPercentage),
      cgpa: form.cgpa === "" || form.cgpa == null ? null : Number(form.cgpa),
    };
    console.log('[FACULTY_FORM] Building payload with department:', {
      department: payload.department,
      departmentLength: payload.department?.length,
      userDepartment: user?.department
    });
    return payload;
  };

  const handleSubmit = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      toast.error(validationError);
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    const payload = buildPayload();

    console.log('[FACULTY_FORM] Submitting with payload:', {
      department: payload.department,
      heading: payload.announcementHeading,
      lastDate: payload.lastDate
    });

    try {
        if (editingId) {
        const match = opportunities.find((item) => (item.id || item._id) === editingId);
        if (match && isArchived(match)) {
          throw new Error("Cannot edit archived opportunities");
        }
        if (match && !canFacultyEditOpportunity(match, user)) {
          throw new Error("You don't have permission to edit this opportunity");
        }
        await updateOpportunity(editingId, payload);
        toast.success("Opportunity updated", { duration: 2500 });
        setMessage("Opportunity updated");
      } else {
        await createOpportunity(payload);
        toast.success("Opportunity created successfully!");
        setMessage("Opportunity created successfully!");
      }
      localStorage.setItem(LAST_DEPARTMENT_KEY, payload.department);
      await loadOpportunities();
      setIsModalOpen(false);
      resetForm();
    } catch (submitError) {
      setError(submitError.message || "Network error - please try again");
      toast.error(submitError.message || "Network error - please try again");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (item) => {
    const id = item.id || item._id;
    if (!canFacultyEditOpportunity(item, user)) {
      setError("You don't have permission to edit this opportunity");
      toast.error("You don't have permission to edit this opportunity");
      return;
    }
    if (isArchived(item)) {
      setError("Cannot edit archived opportunities");
      toast.error("Cannot edit archived opportunities");
      return;
    }
    setSearchParams({ edit: id });
    setSelectedOpportunity(item);
    setIsModalOpen(true);
  };

  const handleDelete = (item) => {
    const id = item.id || item._id;

    if (!facultyCanDeleteOpportunity(user, item)) {
      setError("You don't have permission to delete this opportunity");
      toast.error("You don't have permission to delete this opportunity");
      return;
    }

    toast.custom(
      (t) => (
        <div className="w-[320px] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
          <p className="font-semibold text-slate-900">Delete this opportunity?</p>
          <p className="mt-1 text-sm text-slate-600">This action cannot be undone.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
              onClick={() => toast.dismiss(t.id)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white"
              onClick={async () => {
                toast.dismiss(t.id);
                setDeletingId(id);
                try {
                  await deleteOpportunity(id);
                  toast.success("Opportunity deleted successfully", { icon: "🗑️" });
                  if (selectedOpportunity && (selectedOpportunity.id || selectedOpportunity._id) === id) {
                    setIsModalOpen(false);
                    setSelectedOpportunity(null);
                  }
                  await loadOpportunities();
                  if (editingId === id) resetForm();
                } catch (deleteError) {
                  toast.error(deleteError.message || "Failed to delete opportunity");
                  setError(deleteError.message || "Failed to delete opportunity");
                } finally {
                  setDeletingId("");
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ),
      { duration: 10000 }
    );
  };

  const sorted = useMemo(
    () =>
      [...opportunities].sort(
        (a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
      ),
    [opportunities]
  );

  return (
    <>
      <Layout role="Faculty">
      <SectionTitle title="Faculty Opportunities" subtitle="Create opportunities and collaborate on postings for your department." />
      <StatusMessage message={message} />
      <StatusMessage type="error" message={error} />
      <OpportunityForm
        value={form}
        onChange={setForm}
        onSubmit={handleSubmit}
        submitLabel={editingId ? "Save Changes" : "Create Opportunity"}
        showDepartment
        departmentLocked
        loading={saving}
        isEditing={Boolean(editingId)}
        onCancelEdit={editingId ? resetForm : undefined}
      />
      <div className="mt-6">
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : sorted.length ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {sorted.map((item) => {
              const canEdit = canFacultyEditOpportunity(item, user);
              const canDelete = facultyCanDeleteOpportunity(user, item);
              const canManageItem = canEdit || canDelete;
              return (
                <OpportunityCard
                  key={item.id || item._id}
                  opportunity={item}
                  canManage={canManageItem}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  editDisabled={isArchived(item) || !canEdit}
                  editLoading={Boolean(editingId && (item.id || item._id) === editingId && saving)}
                  deleteLoading={deletingId === (item.id || item._id)}
                />
              );
            })}
          </div>
        ) : (
          <EmptyState title="No opportunities yet" subtitle="Create one using the form above." />
        )}
      </div>
      {isModalOpen && selectedOpportunity ? (
        <div className="sr-only" aria-hidden>
          {selectedOpportunity.announcementHeading}
        </div>
      ) : null}
    </Layout>
    <Footer />
    </>
  );
};

export default FacultyOpportunitiesPage;
