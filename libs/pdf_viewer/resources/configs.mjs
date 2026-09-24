/**
 * English demo configurations loaded with ccm.load("./resources/configs.mjs#demo")
 * or #protectedDemo. The component itself defaults to German labels.
 * ././ resource prefixes are replaced by absolute URLs during ccmjs versioning.
 */
export const demo = {
  pdf: "././resources/demo.pdf",
  filename: "demo.pdf",
  labels: {
    viewer: "PDF Viewer", previous: "Previous", next: "Next", page: "Page", of: "of",
    zoomOut: "Zoom out", zoomIn: "Zoom in", fit: "Fit to width", download: "Download",
    loading: "Loading PDF …", rendering: "Loading page …", missing: "No PDF URL provided.",
    error: "The PDF could not be loaded or displayed.",
    password: "Please enter the password for this PDF.",
    passwordIncorrect: "Incorrect password. Please try again.",
    passwordLabel: "Password", unlock: "Open PDF", cancel: "Cancel",
    passwordCancelled: "Opening the PDF was cancelled.",
    invalidPage: "Please enter a valid page number.", link: "Link in PDF",
  },
};

/**
 * Password: viewer-test. The omitted password uses the component's empty default.
 * Uncomment password below to bypass the prompt. To test the prompt on every visit,
 * also set rememberPassword: false; otherwise a successful entry is reused in this tab.
 * The spread shares the English labels with demo; treat exported configs as templates.
 */
export const protectedDemo = {
  ...demo,
  pdf: "././resources/protected.pdf",
  filename: "protected.pdf",
  // password: "viewer-test",
};
