const prefersLight = window.matchMedia("(prefers-color-scheme: light)");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

function getPreferredTheme() {
  if (prefersLight.matches) return "light";
  if (prefersDark.matches) return "dark";
  return null;
}

function getStoredTheme() {
  return window.localStorage.getItem("theme");
}

function getCurrentTheme() {
  return document.documentElement.dataset.theme ?? getPreferredTheme() ?? "light";
}

function setTheme(theme) {
  if (theme == getPreferredTheme()) {
    delete document.documentElement.dataset.theme;
    window.localStorage.removeItem("theme");
  } else {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("theme", theme);
  }
}

function toggleTheme() {
  const currentTheme = getCurrentTheme();
  const nextTheme = currentTheme == "light" ? "dark" : "light";
  setTheme(nextTheme);
}

function updatePreferredTheme() {
  const current = getCurrentTheme();
  if (current == getPreferredTheme()) {
    window.localStorage.removeItem("theme");
  } else {
    window.localStorage.setItem("theme", current);
  }
}

setTheme(getStoredTheme() ?? getPreferredTheme() ?? "light");

prefersLight.addEventListener("change", updatePreferredTheme);
prefersDark.addEventListener("change", updatePreferredTheme);

window.addEventListener("DOMContentLoaded", () => {
  document
    .querySelectorAll(".theme-toggle")
    .forEach((el) => el.addEventListener("click", toggleTheme));
});
