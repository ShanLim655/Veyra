const FLAG = "veyra-password-recovery";
const LEGACY_FLAG = "chatt-password-recovery";

export function setPasswordRecoveryFlag() {
  window.sessionStorage.setItem(FLAG, "true");
  window.sessionStorage.removeItem(LEGACY_FLAG);
}

export function hasPasswordRecoveryFlag() {
  if (window.sessionStorage.getItem(FLAG) === "true") return true;
  if (window.sessionStorage.getItem(LEGACY_FLAG) !== "true") return false;
  setPasswordRecoveryFlag();
  return true;
}

export function clearPasswordRecoveryFlag() {
  window.sessionStorage.removeItem(FLAG);
  window.sessionStorage.removeItem(LEGACY_FLAG);
}
