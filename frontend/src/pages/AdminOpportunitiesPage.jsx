import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import api, { extractApiData, extractApiError } from "../api";
import Layout from "../components/Layout";
import Footer from "../components/Footer";
import OpportunityForm from "../components/OpportunityForm";
import OpportunityCard from "../components/OpportunityCard";
import { EmptyState, SectionTitle, Spinner, StatusMessage } from "../components/ui";
import { OPPORTUNITY_BROADCAST_ALL, GENDER_OPTIONS } from "../constants/departments";

const initial = {
  announcementHeading: "",
  type: "Internship",
  description: "",
  eligibilityCriteria: [],
  eligibleGenders: [...GENDER_OPTIONS],
  sscPercentage: "",
  hscPercentage: "",
  cgpa: "",
  lastDate: "",
  department: OPPORTUNITY_BROADCAST_ALL,
  technicalSkills: [],
  applicationLink: "",
};

const AdminOpportunitiesPage = () => {
  const [form, setForm] = useState(initial);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [deletingId, setDeletingId] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get("/opportunities/active");
      setItems(extractApiData(response) || []);
    } catch (err) {
      setError(extractApiError(err, "Failed to load opportunities"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId) return;

    const prefillFromId = async () => {
      try {
        toast("Editing opportunity...");
        const response = await api.get(`/opportunities/${editId}`);
        const item = extractApiData(response);
        if (!item) {
          throw new Error("Opportunity not found");
        }
        if (item.status === "archived") {
          setError("Cannot edit archived opportunities");
          toast.error("Cannot edit archived opportunities");
          setSearchParams({});
          return;
        }
        setForm({
          announcementHeading: item.announcementHeading || "",
          type: item.type || "Internship",
          description: item.description || "",
          eligibilityCriteria: item.eligibilityCriteria
            ? item.eligibilityCriteria.split(", ").filter(Boolean)
            : [],
          lastDate: item.lastDate ? new Date(item.lastDate).toISOString().split("T")[0] : "",
          department: item.department || OPPORTUNITY_BROADCAST_ALL,
          technicalSkills: Array.isArray(item.technicalSkills) ? item.technicalSkills : [],
          applicationLink: item.applicationLink || "",
          eligibleGenders:
            Array.isArray(item.eligibleGenders) && item.eligibleGenders.length > 0
              ? item.eligibleGenders
              : [...GENDER_OPTIONS],
          sscPercentage: item.sscPercentage ?? "",
          hscPercentage: item.hscPercentage ?? "",
          cgpa: item.cgpa ?? "",
        });
        setEditingId(item._id);
      } catch (err) {
        const message = extractApiError(err, "Failed to load opportunity for editing");
        setError(message);
        toast.error(message);
        setSearchParams({});
      }
    };

    prefillFromId();
  }, [searchParams, setSearchParams]);

  const resetForm = () => {
    setForm(initial);
    setEditingId(null);
    setSearchParams({});
  };

  const validateAcademicEligibility = () => {
    const toOptionalNumber = (value, min, max, label) => {
      if (value === undefined || value === null || value === "") return null;
      const n = Number(value);
      if (Number.isNaN(n)) return `${label} must be a number`;
      if (n < min || n > max) return `${label} must be between ${min} and ${max}`;
      return null;
    };
    return (
      toOptionalNumber(form.sscPercentage, 0, 100, "SSC percentage") ||
      toOptionalNumber(form.hscPercentage, 0, 100, "HSC percentage") ||
      toOptionalNumber(form.cgpa, 0, 10, "CGPA")
    );
  };

  const buildAcademicPayload = () => ({
    sscPercentage: form.sscPercentage === "" || form.sscPercentage == null ? null : Number(form.sscPercentage),
    hscPercentage: form.hscPercentage === "" || form.hscPercentage == null ? null : Number(form.hscPercentage),
    cgpa: form.cgpa === "" || form.cgpa == null ? null : Number(form.cgpa),
  });

  const createOpportunity = async () => {
    setError("");
    setMessage("");
    const hasEligibility = Array.isArray(form.eligibilityCriteria)
      ? form.eligibilityCriteria.length > 0
      : Boolean(form.eligibilityCriteria);
    if (!form.announcementHeading || !form.type || !form.description || !hasEligibility || !form.lastDate || !form.department) {
      setError("Please fill all required fields.");
      return;
    }
    const academicError = validateAcademicEligibility();
    if (academicError) {
      setError(academicError);
      return;
    }
    setSaving(true);
    try {
      const eligibleYearsArray = Array.isArray(form.eligibilityCriteria)
        ? form.eligibilityCriteria.filter(Boolean)
        : [];

      const payload = {
        ...form,
        announcementHeading: form.announcementHeading.trim(),
        description: form.description.trim(),
        department: form.department,
        applicationLink: form.applicationLink || "",
        eligibilityCriteria: Array.isArray(form.eligibilityCriteria)
          ? form.eligibilityCriteria.filter(Boolean).join(", ")
          : (form.eligibilityCriteria || "").trim(),
        eligibleYears: eligibleYearsArray,
        eligibleGenders: Array.isArray(form.eligibleGenders) ? form.eligibleGenders : [...GENDER_OPTIONS],
        ...buildAcademicPayload(),
      };
      await api.post("/opportunities", payload);
      resetForm();
      await load();
      setMessage("Opportunity created successfully.");
      toast.success("Opportunity created");
    } catch (err) {
      setError(extractApiError(err, "Failed to create opportunity"));
    } finally {
      setSaving(false);
    }
  };

  const updateOpportunity = async (id, payload) => {
    const response = await api.put(`/opportunities/${id}`, payload);
    return extractApiData(response);
  };

  const deleteOpportunity = async (id) => {
    const response = await api.delete(`/opportunities/${id}`);
    return extractApiData(response);
  };

  const handleEdit = (item) => {
    const id = item._id;
    setSearchParams({ edit: id });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setError("");
    setMessage("");
    const hasEligibility = Array.isArray(form.eligibilityCriteria)
      ? form.eligibilityCriteria.length > 0
      : Boolean(form.eligibilityCriteria);
    if (!form.announcementHeading || !form.type || !form.description || !hasEligibility || !form.lastDate || !form.department) {
      setError("Please fill all required fields.");
      return;
    }
    const academicError = validateAcademicEligibility();
    if (academicError) {
      setError(academicError);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        announcementHeading: form.announcementHeading.trim(),
        description: form.description.trim(),
        department: form.department,
        applicationLink: form.applicationLink || "",
        eligibilityCriteria: Array.isArray(form.eligibilityCriteria)
          ? form.eligibilityCriteria.filter(Boolean).join(", ")
          : (form.eligibilityCriteria || "").trim(),
        eligibleYears: Array.isArray(form.eligibilityCriteria)
          ? form.eligibilityCriteria.filter(Boolean)
          : [],
        eligibleGenders: Array.isArray(form.eligibleGenders) ? form.eligibleGenders : [...GENDER_OPTIONS],
        ...buildAcademicPayload(),
      };
      await updateOpportunity(editingId, payload);
      resetForm();
      await load();
      setMessage("Opportunity updated successfully.");
      toast.success("Opportunity updated");
    } catch (err) {
      setError(extractApiError(err, "Failed to update opportunity"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (item) => {
    const id = item._id;
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
                  await load();
                  setMessage("Opportunity deleted successfully.");
                  toast.success("Opportunity deleted");
                  if (editingId === id) resetForm();
                } catch (err) {
                  setError(extractApiError(err, "Failed to delete opportunity"));
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

  const isArchived = (item) => {
    if (item.status === "archived") return true;
    const lastMidnight = new Date(item.lastDate);
    lastMidnight.setHours(0, 0, 0, 0);
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    return todayMidnight > lastMidnight;
  };

  return (
    <>
      <Layout role="Admin">
        <SectionTitle title="Opportunities" subtitle="Create, edit, and manage opportunities." />
        <StatusMessage message={message} />
        <StatusMessage type="error" message={error} />

        {/* Opportunity Form */}
        <div className="mb-6 sm:mb-8">
          <OpportunityForm
            value={form}
            onChange={setForm}
            onSubmit={editingId ? handleSaveEdit : createOpportunity}
            submitLabel={editingId ? "Save Changes" : "Create Opportunity"}
            showDepartment
            loading={saving}
            isEditing={Boolean(editingId)}
            onCancelEdit={editingId ? resetForm : undefined}
          />
        </div>

        {/* Opportunities Grid */}
        <section className="mt-8 sm:mt-10">
          <h2 className="text-lg sm:text-xl font-semibold text-slate-900 mb-5">Active Opportunities</h2>
          {loading ? (
            <div className="py-12 flex justify-center">
              <Spinner />
            </div>
          ) : items.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-6">
              {items.map((item) => (
                <OpportunityCard
                  key={item._id}
                  opportunity={item}
                  canManage
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  editDisabled={isArchived(item)}
                  editLoading={Boolean(editingId && item._id === editingId && saving)}
                  deleteLoading={deletingId === item._id}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="No active opportunities" subtitle="Create an opportunity using the form above." />
          )}
        </section>
      </Layout>
      <Footer />
    </>
  );
};

export default AdminOpportunitiesPage;
