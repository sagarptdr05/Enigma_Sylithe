import { Link, NavLink } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import Logo from "./Logo";

/** Marketing header (landing, login, register). The app itself uses the sidebar shell. */
export default function Navbar() {
  const { user } = useAuth();
  const cls = ({ isActive }: { isActive: boolean }) => `px-3 h-9 inline-flex items-center rounded-md text-sm ${isActive ? "text-ink font-medium" : "text-muted hover:text-ink"}`;
  return (
    <header className="sticky top-0 z-[1000] border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto max-w-[1200px] px-5 h-16 flex items-center gap-6">
        <Link to="/" className="flex items-center gap-2 font-brand font-bold text-xl text-brand"><Logo /> Sylithex</Link>
        <nav className="hidden md:flex items-center gap-1">
          <NavLink to="/solutions" className={cls}>How it works</NavLink>
          <NavLink to="/dashboard" className={cls}>Platform</NavLink>
          <NavLink to="/discover" className={cls}>Discover</NavLink>
          <NavLink to="/impact" className={cls}>Impact</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? <Link to={user.role === "facilitator" ? "/my" : "/my"} className="btn-primary">Open workspace <ArrowRight size={15} /></Link> : <>
            <Link to="/login" className="btn text-ink hover:bg-subtle">Log in</Link>
            <Link to="/signup" className="btn-primary">Register plant</Link>
          </>}
        </div>
      </div>
    </header>
  );
}
