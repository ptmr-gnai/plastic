import type { Rectangle } from "electron";

export type VisibleRef = {
  ref?: string;
  panel?: string;
  extension?: string;
  command?: string;
  tag: string;
  text: string;
  bounds?: Rectangle;
};

export type WindowVisibleRefs = {
  windowId: number;
  refs: VisibleRef[];
};

export type ScreenshotInput = {
  windowId?: number;
  ref?: string;
};

export type RefInput = {
  windowId?: number;
  ref?: string;
  value?: string;
};

export type VerifyRefActionInput = {
  ref?: string;
  panelId?: string;
  expectedEventType?: string;
  expectedContent?: string;
  after?: string;
  limit?: number;
};
