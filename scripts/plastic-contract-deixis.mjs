export const assertDeixisMethodDescriptions = ({ assert, descriptions }) => {
  assert(descriptions.listVisibleRefs.outputSchema?.type === "array", "deixis/listVisibleRefs output schema must be an array");
  assert(descriptions.listVisibleRefs.outputSchema?.items?.required?.includes("refs"), "deixis/listVisibleRefs item schema must require refs");
  assert(descriptions.screenshot.outputSchema?.required?.includes("dataUrl"), "windows/screenshot output schema must require dataUrl");
  assert(descriptions.resolveRef.outputSchema?.required?.includes("actions"), "deixis/resolveRef output schema must require actions");
  assert(descriptions.evalDom.outputSchema?.description?.includes("DOM script"), "deixis/evalDom output schema must describe DOM script result");
  assert(descriptions.verifyRefAction.outputSchema?.required?.includes("verificationEventId"), "deixis/verifyRefAction output schema must require verificationEventId");
  assert(descriptions.clickRef.outputSchema?.required?.includes("eventId"), "deixis/clickRef output schema must require eventId");
  assert(descriptions.fillRef.outputSchema?.required?.includes("eventId"), "deixis/fillRef output schema must require eventId");
  assert(descriptions.clickRef.effects?.durableEvents?.includes("deixis.ref.clicked"), "deixis/clickRef must describe clicked event");
  assert(descriptions.fillRef.effects?.durableEvents?.includes("deixis.ref.filled"), "deixis/fillRef must describe filled event");
};
