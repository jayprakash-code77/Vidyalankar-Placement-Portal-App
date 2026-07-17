import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { ShieldCheck, UserCog } from "lucide-react";
import toast from "react-hot-toast";
import api, { extractApiData, extractApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { PrimaryButton, StatusMessage } from "../components/ui";
import PasswordInput from "../components/PasswordInput";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

const LoginPage = () => {
  const [form, setForm] = useState({ role: "student", identifier: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (form.role === "student" && !form.identifier.trim()) {
        setError("Student ID or email is required");
        setLoading(false);
        return;
      }
      if (form.role === "student" && !form.password.trim()) {
        setError("Password is required");
        setLoading(false);
        return;
      }
      if (form.role !== "student" && (!form.email.trim() || !form.password.trim())) {
        setError("Email and password are required");
        setLoading(false);
        return;
      }
      const identifier = form.identifier.trim();
      const isEmail = identifier.includes("@");
      const payload =
        form.role === "student"
          ? isEmail
            ? { role: "student", email: identifier, password: form.password }
            : { role: "student", studentId: identifier, password: form.password }
          : { role: form.role, email: form.email.trim(), password: form.password };
      const response = await api.post("/auth/login", payload);
      const data = extractApiData(response);
      login(data.accessToken, data.user);
      navigate("/");
    } catch (err) {
      const status = err.response?.status;
      const apiMsg = extractApiError(err, "Login failed");
      let display = apiMsg;
      if (!err.response) {
        display = "Network error. Check your connection and try again.";
      } else if (status >= 500) {
        display = "Server error. Please try again shortly.";
      }
      setError(display);
      toast.error(display);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-3 xs:px-4 py-8 xs:py-10">
        <div className="pointer-events-none absolute -left-24 top-0 h-64 w-64 rounded-full bg-indigo-200/50 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-sky-200/50 blur-3xl" />
        <Motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={submit}
        className="glass-panel relative w-full max-w-md space-y-4 xs:space-y-5 border-slate-200/80 p-4 xs:p-5 sm:p-7 rounded-2xl xs:rounded-2xl"
      >
        <div className="mb-1 flex flex-col items-start gap-2">
          <div className="w-full">
            {/* 
            <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-2 xs:px-2.5 py-0.5 xs:py-1 text-xs font-medium text-red-700">
              <ShieldCheck size={12} className="xs:size-3.5" />
              Secure access
            </div>
              */}
            <h1 className="text-xl xs:text-2xl font-semibold text-slate-900">Welcome back</h1>
            <p className="mt-1 text-xs xs:text-sm text-slate-600">Login to continue to your placement portal dashboard.</p>
          </div>
        </div>
        <div className="space-y-1.5 xs:space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Role</p>
          <select className="input-modern text-xs xs:text-base" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="student">Student</option><option value="faculty">Faculty</option><option value="admin">Admin</option>
          </select>
        </div>
        {form.role === "student" ? (
          <div className="space-y-2 xs:space-y-3">
            <div className="space-y-1.5 xs:space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600"> Roll Number or Email</p>
              <input className="input-modern text-xs xs:text-base" placeholder="Enter your student ID or email" onChange={(e) => setForm({ ...form, identifier: e.target.value })} />
            </div>
            <div className="space-y-1.5 xs:space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Password</p>
              <PasswordInput placeholder="Enter your password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
        ) : (
          <div className="space-y-2 xs:space-y-3">
            <div className="space-y-1.5 xs:space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Email</p>
              <input className="input-modern text-xs xs:text-base" placeholder="name.surname@vsit.edu.in" onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5 xs:space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Password</p>
              <PasswordInput placeholder="Enter your password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
        )}
        <StatusMessage type="error" message={error} className="text-xs xs:text-sm" />
        <PrimaryButton loading={loading} disabled={loading} className="w-full rounded-lg xs:rounded-xl py-2.5 xs:py-3 text-xs xs:text-sm">{loading ? "Logging In..." : "Login"}</PrimaryButton>
        <div className={`flex flex-col xs:flex-row items-start xs:items-center gap-2 border-t border-slate-200 pt-2 ${form.role === "student" ? "justify-between" : "justify-end"}`}>
          {form.role === "student" ? (
            <Link className="flex items-center gap-1 text-xs xs:text-sm text-red-600 transition-colors duration-200 ease-in-out hover:text-red-500" to="/register"><UserCog size={13} className="xs:size-3.5" />New student? Register</Link>
          ) : null}
          <Link className="text-xs xs:text-sm text-red-600 hover:text-red-700" to="/forgot-password">Forgot password?</Link>
        </div>
      </Motion.form>
      </div>
      <Footer />
    </>
  );
};

export default LoginPage;
