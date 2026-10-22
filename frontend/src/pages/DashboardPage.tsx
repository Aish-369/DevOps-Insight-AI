
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function DashboardPage() {
  const navigate = useNavigate();

  async function handleLogout() {
    // End the Supabase session.
    const { error } = await supabase.auth.signOut();

    if (!error) {
      navigate("/login", { replace: true });
    }
  }

  return (
    <main className="min-h-screen bg-[#fff5e8] p-8">
      <div className="clay-card mx-auto max-w-4xl rounded-3xl p-8">
        <h1 className="text-3xl font-bold">
          DevOps Insight AI
        </h1>

        <p className="mt-3 text-[#68756d]">
          You are signed in. Your agency workspace will appear here.
        </p>

        <button
          onClick={handleLogout}
          className="mt-8 rounded-2xl bg-[#e99d7f] px-6 py-3 font-bold"
        >
          Sign Out
        </button>
      </div>
    </main>
  );
}
