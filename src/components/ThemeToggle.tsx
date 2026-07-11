"use client";
import { useEffect, useState } from "react";
import styles from "./ThemeToggle.module.css";

// Small sun/moon switch. Persists to localStorage and sets data-theme on <html>.
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("trailrate-theme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const isDark = saved ? saved === "dark" : !!prefersDark;
    setDark(isDark);
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    // enable smooth transition only during the switch
    document.documentElement.classList.add("theme-anim");
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    localStorage.setItem("trailrate-theme", next ? "dark" : "light");
    window.setTimeout(() => document.documentElement.classList.remove("theme-anim"), 350);
  }

  if (!mounted) return <div className={styles.placeholder} />;

  return (
    <button className={styles.toggle} onClick={toggle} aria-label={dark ? "Passer en clair" : "Passer en sombre"} title={dark ? "Mode clair" : "Mode sombre"}>
      <span className={`${styles.track} ${dark ? styles.trackDark : ""}`}>
        <span className={styles.thumb}>
          {dark ? (
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round"/>
            </svg>
          )}
        </span>
      </span>
    </button>
  );
}
