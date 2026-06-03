import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { PlasticExtension } from "@plastic/core";

export interface ExtensionVerificationCheck {
  name: string;
  ok: boolean;
  message: string;
}

export interface ExtensionVerificationReport {
  extensionId: string;
  ok: boolean;
  checks: ExtensionVerificationCheck[];
  warnings: string[];
  errors: string[];
  panel?: PlasticExtension["panels"][number];
}

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const addVerificationCheck = (
  report: ExtensionVerificationReport,
  check: ExtensionVerificationCheck,
  severity: "error" | "warning" = "error"
) => {
  report.checks.push(check);
  if (check.ok) {
    return;
  }
  if (severity === "warning") {
    report.warnings.push(check.message);
    return;
  }
  report.errors.push(check.message);
};

const verifyExtensionIdentity = async (
  workspaceDir: string,
  extension: PlasticExtension,
  report: ExtensionVerificationReport
) => {
  addVerificationCheck(report, {
    name: "extension.errors",
    ok: extension.errors.length === 0,
    message: extension.errors.length === 0
      ? "Extension has no discovery errors."
      : `Extension has discovery errors: ${extension.errors.join("; ")}`
  });

  const extensionPath = extension.path ? join(workspaceDir, extension.path) : undefined;
  const extensionPathExists = extensionPath ? await pathExists(extensionPath) : false;
  addVerificationCheck(report, {
    name: "extension.path",
    ok: extensionPathExists,
    message: extensionPath
      ? `Extension path ${extension.path} ${extensionPathExists ? "exists" : "does not exist"}.`
      : "Extension has no path."
  });

  if (!extension.manifestPath) {
    return;
  }

  const manifestPath = join(workspaceDir, extension.manifestPath);
  const manifestPathExists = await pathExists(manifestPath);
  addVerificationCheck(report, {
    name: "extension.manifest",
    ok: manifestPathExists,
    message: `Manifest ${extension.manifestPath} ${manifestPathExists ? "exists" : "does not exist"}.`
  });
};

const verifyExtensionRenderers = async (
  workspaceDir: string,
  extension: PlasticExtension,
  report: ExtensionVerificationReport
) => {
  for (const renderer of extension.renderers) {
    addVerificationCheck(report, {
      name: `renderer.${renderer.id}.panelKinds`,
      ok: renderer.panelKinds.length > 0,
      message: renderer.panelKinds.length > 0
        ? `Renderer ${renderer.id} declares panel kinds: ${renderer.panelKinds.join(", ")}.`
        : `Renderer ${renderer.id} declares no panel kinds.`
    }, "warning");

    if (renderer.module && extension.path) {
      const modulePath = join(workspaceDir, extension.path, renderer.module);
      const modulePathExists = await pathExists(modulePath);
      addVerificationCheck(report, {
        name: `renderer.${renderer.id}.module`,
        ok: modulePathExists,
        message: `Renderer module ${extension.path}/${renderer.module} ${modulePathExists ? "exists" : "does not exist"}.`
      });
    }
  }
};

const verifyExtensionPanels = (
  extension: PlasticExtension,
  report: ExtensionVerificationReport,
  panelId?: string
) => {
  const rendererIds = new Set(extension.renderers.map((renderer) => renderer.id));
  addVerificationCheck(report, {
    name: "extension.panels",
    ok: extension.panels.length > 0,
    message: extension.panels.length > 0
      ? `Extension declares ${extension.panels.length} panel contribution(s).`
      : "Extension declares no panel contributions."
  });

  for (const panel of extension.panels) {
    addVerificationCheck(report, {
      name: `panel.${panel.id}.identity`,
      ok: panel.id.length > 0 && panel.title.length > 0,
      message: panel.id.length > 0 && panel.title.length > 0
        ? `Panel ${panel.id} has a stable id and title.`
        : "Panel is missing a stable id or title."
    });

    if (panel.rendererId) {
      addVerificationCheck(report, {
        name: `panel.${panel.id}.renderer`,
        ok: rendererIds.has(panel.rendererId),
        message: rendererIds.has(panel.rendererId)
          ? `Panel ${panel.id} references renderer ${panel.rendererId}.`
          : `Panel ${panel.id} references missing renderer ${panel.rendererId}.`
      });
    }
  }

  if (panelId) {
    const panel = extension.panels.find((candidate) => candidate.id === panelId);
    if (panel) {
      report.panel = panel;
    }
    addVerificationCheck(report, {
      name: "input.panelId",
      ok: Boolean(panel),
      message: panel
        ? `Requested panel ${panelId} exists.`
        : `Requested panel ${panelId} does not exist on ${extension.id}.`
    });
  }
};

export const verifyExtension = async (
  workspaceDir: string,
  extension: PlasticExtension,
  panelId?: string
): Promise<ExtensionVerificationReport> => {
  const report: ExtensionVerificationReport = {
    extensionId: extension.id,
    ok: false,
    checks: [],
    warnings: [],
    errors: []
  };

  await verifyExtensionIdentity(workspaceDir, extension, report);
  await verifyExtensionRenderers(workspaceDir, extension, report);
  verifyExtensionPanels(extension, report, panelId);
  if (extension.methods.length === 0) {
    report.warnings.push("Extension declares no RPC methods.");
  }

  report.ok = report.errors.length === 0;
  return report;
};
