import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { ArrowLeft, Sparkles, CheckCircle } from "lucide-react";
import api, { extractApiData, extractApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { PrimaryButton, StatusMessage } from "../components/ui";
import PasswordInput from "../components/PasswordInput";
import { DEPARTMENTS, GENDER_OPTIONS } from "../constants/departments";
import { getYearsForCourse } from "../utils/courseYearMapping";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

const RegisterPage = () => {
  const [step, setStep] = useState(1);
  const [yearOptions, setYearOptions] = useState([]);
  const [form, setForm] = useState({
    name: "",
    studentId: "",
    department: "",
    year: "",
    email: "",
    phone: "",
    gender: "",
    password: "",
    otp: "",
  });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();
  const instituteEmailRegex = /^[a-z]+(?:\.[a-z]+)+@vsit\.edu\.in$/i;

  // Update year options when department changes
  useEffect(() => {
    if (form.department) {
      const years = getYearsForCourse(form.department);
      setYearOptions(years);
      // Clear previously selected year when department changes
      setForm((prev) => ({ ...prev, year: "" }));
    } else {
      setYearOptions([]);
      setForm((prev) => ({ ...prev, year: "" }));
    }
  }, [form.department]);

  const register = async () => {
    setError("");
    setMsg("");
    if (!form.name.trim() || !form.studentId.trim() || !form.department.trim() || !form.year.trim() || !form.email.trim() || !form.phone.trim() || !form.gender.trim() || !form.password.trim()) {
      setError("Name, student ID, email, department, year, gender, phone and password are required.");
      return;
    }
    if (!instituteEmailRegex.test(form.email.trim())) {
      setError("Email must follow name.surname@vsit.edu.in format.");
      return;
    }
    if (!/^\d{10}$/.test(form.phone.trim())) {
      setError("Phone number must be exactly 10 digits.");
      return;
    }
    if (!/^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(form.password)) {
      setError("Password must be 8+ chars with uppercase, number and special character.");
      return;
    }
    setLoading(true);
    try {
      const response = await api.post("/auth/register", form);
      const data = extractApiData(response);
      if (data?.otpDelivery === "failed") {
        setMsg("⚠️ Email delivery failed. Please contact support.");
      } 
      setStep(2);
    } catch (err) {
      setError(extractApiError(err, "Registration failed"));
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    if (!form.otp.trim()) {
      setError("OTP is required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await api.post("/auth/verify-otp", { studentId: form.studentId, otp: form.otp });
      const data = extractApiData(response);
      setMsg("✅ Email verified successfully! Redirecting to login...");
      setTimeout(() => {
        navigate("/login");
      }, 1500);
    } catch (err) {
      setError(extractApiError(err, "OTP verification failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-3 xs:px-4 py-8 xs:py-10">
        <div className="pointer-events-none absolute -left-20 bottom-10 h-64 w-64 rounded-full bg-indigo-200/50 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 top-8 h-72 w-72 rounded-full bg-cyan-200/50 blur-3xl" />
        <Motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-panel relative w-full max-w-2xl space-y-4 xs:space-y-5 border-slate-200/80 p-4 xs:p-5 sm:p-7 rounded-2xl xs:rounded-2xl">
        <div className="flex flex-col xs:flex-row items-start gap-2 xs:gap-3">
          <div className="flex-1 min-w-0">
            {/*             
            <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-2 xs:px-2.5 py-0.5 xs:py-1 text-xs font-medium text-red-700">
              <Sparkles size={12} className="xs:size-3.5" />
              Student Registration
            </div> */}
            <h1 className="text-xl xs:text-2xl font-semibold text-slate-900">Create Student Account</h1>
            <p className="mt-1 text-xs xs:text-sm text-slate-600">
              {step === 1
                ? "Step 1/2: Create your pending account with institute details."
                : "Step 2/2: Enter OTP to activate your account and login."
              }
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-2.5 xs:px-3 py-0.5 xs:py-1 text-xs font-medium text-slate-600 whitespace-nowrap">
            Step {step} of 2
          </span>
        </div>
        {step === 1 ? (
          <div className="grid grid-cols-1 gap-3 xs:gap-4 md:grid-cols-2">
            <div className="space-y-1.5 xs:space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Name</p>
              <input className="input-modern text-xs xs:text-base" placeholder="Full name" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5 xs:space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Student Roll Number</p>
              <input className="input-modern text-xs xs:text-base" placeholder="Student Roll Number" onChange={(e) => setForm({ ...form, studentId: e.target.value })} />
            </div>
            <div className="space-y-1.5 xs:space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Department</p>
              <select className="input-modern text-xs xs:text-base" onChange={(e) => setForm({ ...form, department: e.target.value })} defaultValue="">
                <option value="" disabled>Select Department</option>
                {DEPARTMENTS.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 xs:space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Year</p>
              <select className="input-modern text-xs xs:text-base" onChange={(e) => setForm({ ...form, year: e.target.value })} defaultValue="" disabled={!form.department}>
                <option value="" disabled>Select Year</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 xs:space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Gender</p>
              <select
                className="input-modern text-xs xs:text-base"
                value={form.gender}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
              >
                <option value="" disabled>Select gender</option>
                {GENDER_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 xs:space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Institute Email</p>
              <input className="input-modern text-xs xs:text-base" placeholder="name.surname@vsit.edu.in" onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5 xs:space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Phone Number</p>
              <input className="input-modern text-xs xs:text-base" placeholder="Enter your 10-digit phone number" type="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-1.5 xs:space-y-2 md:col-span-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Password</p>
              <PasswordInput placeholder="Create a strong password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <p className="text-xs text-slate-500 md:col-span-2">
              Password must be at least 8 characters and include one uppercase letter, one number, and one special character.
            </p>
            <PrimaryButton loading={loading} disabled={loading} onClick={register} className="w-full rounded-lg xs:rounded-xl py-2.5 xs:py-3 text-xs xs:text-sm md:col-span-2">{loading ? "Sending OTP..." : "Send OTP"}</PrimaryButton>
          </div>
        ) : (
        <div className="space-y-3 xs:space-y-4">
          <div className="rounded-lg xs:rounded-xl border border-emerald-100 bg-emerald-50 p-3 xs:p-4 text-xs xs:text-sm text-emerald-800 mb-3 xs:mb-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={16} className="xs:size-5 text-emerald-600" />
              <strong className="text-xs xs:text-sm">Account Pending Verification</strong>
            </div>
            <p className="text-xs xs:text-sm">Enter 6-digit OTP sent to <span className="font-semibold">{form.email || "your email"}</span></p>
          </div>
            <div className="space-y-1.5 xs:space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">OTP</p>
              <input className="input-modern text-xs xs:text-base" placeholder="Enter 6-digit OTP" onChange={(e) => setForm({ ...form, otp: e.target.value })} />
            </div>
            <PrimaryButton loading={loading} disabled={loading} onClick={verify} className="w-full rounded-lg xs:rounded-xl py-2.5 xs:py-3 text-xs xs:text-sm">{loading ? "Verifying OTP..." : "Verify OTP"}</PrimaryButton>
          </div>
        )}
        <StatusMessage message={msg} className="text-xs xs:text-sm" />
        <StatusMessage type="error" message={error} className="text-xs xs:text-sm" />
        <Link
          to="/login"
          className="inline-flex items-center gap-1 text-xs xs:text-sm text-red-600 transition-colors duration-200 ease-in-out hover:text-red-500"
        >
          <ArrowLeft size={13} className="xs:size-3.5" />
          Back to login
        </Link>
      </Motion.div>
      </div>
      <Footer />
    </>
  );
};

export default RegisterPage;
