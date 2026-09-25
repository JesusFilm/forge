# Watch beta feedback — Photo, Draw, Send

Status: implemented locally. Part of feat-551. This document supersedes the earlier default four-step UI; the existing form remains available as Advanced report. Physical iPhone and delivery verification remain open.

## Reference mapping

| Reference | Screen or behavior                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| 1         | Default entry: Show us the issue, empty photo area, Take a photo, Choose a photo, Advanced report link       |
| 2         | Photo selected: large preview, Select / Draw / Undo, Continue, Skip drawing                                  |
| 3         | Review: final marked photo, Edit drawing, optional note, Send feedback                                       |
| 4         | Full-screen drawing dialog opened by Draw or Edit drawing                                                    |
| 5         | Confirmation after the server accepts the report: Feedback received, Report saved, submitted thumbnail, Done |

Use consistent Watch branding and one Photo → Draw → Send step indicator across all screens. Use the actual selected photo throughout. Reference TV pictures and error messages are visual examples, not content to embed in reports.

## Default flow

1. **Photo:** `/tv` opens the new photo-first flow. Show the reference 1 layout with prominent camera and photo-library actions. Choosing or taking one valid image advances to Draw. Canceling the phone picker leaves the screen unchanged. Keep QR platform/version context automatically; do not ask the tester to re-enter it.
2. **Draw:** show the photo using reference 2. Draw opens the full-screen reference 4 editor with the pen active. Select opens that editor in selection mode. Undo on the preview reverses the latest saved drawing edit; disable it when there is no edit. Continue uses the current image. Skip drawing is available when no marks exist; otherwise offer Continue with the marked image rather than silently removing marks.
3. **Send:** show reference 3 with a large uncropped preview and optional note. Edit drawing reopens reference 4 with the saved objects. Sending uploads and validates the final image, then submits the report. Display Preparing photo and Sending feedback as separate states. Keep the photo, marks, note, and submission key on retry.
4. **Received:** after the server confirms durable acceptance, show reference 5 with the exact submitted thumbnail. Show Report saved while queued and Delivered to the team only after confirmed delivery. In local validation-only mode say Saved for testing. Done leaves a compact completion state with an optional Send another report action; it must not resend or rely on closing a browser tab.

## Drawing popup — reference 4

- Fill the phone viewport with Mark this photo and Cancel at the top, icon-and-label tools, a large photo canvas, and a fixed bottom area containing selection help and Save photo.
- Tools: Select, Draw, Arrow, Box, Text, Cover, Undo, Redo. Keep tap targets at least 44 CSS pixels. On narrow phones allow horizontal scrolling in the toolbar without shrinking the tools.
- Each stroke, arrow, box, text label, and cover is an independent object. Tap selects it; drag moves it. The white selection outline travels with the object throughout the gesture. Delete mark removes only the selected object and can be undone.
- Reference 4 includes corner handles: make these functional for resizing the selected object. Keep text and freehand strokes proportional; normalize stored dimensions after transforms. Do not show decorative handles that do nothing.
- Keep selection outlines and handles out of the exported image. Flatten cover marks into opaque pixels in the submitted image.
- Save photo commits the edit and returns to the screen that opened the dialog. Cancel discards only changes made since opening it. Reopening retains the original source and saved editable objects until submission.
- Store coordinates relative to the source image. Rotation, canvas resizing, and phone keyboard appearance must preserve alignment. Lock background scrolling while the dialog is open and restore focus to the invoking button when it closes.

## Preserve the current form

- Make the new flow the default at `/tv`; move the current wizard to `/tv/advanced`, linked as Advanced report in the header.
- Keep video, multiple attachments, text-only reports, categories, and detailed TV/contact fields in Advanced report.
- Preserve QR context when switching. Transfer any existing photo, marks, and note through shared draft state rather than clearing the report. Show the old form only after choosing Advanced report.
- Keep English and Thai labels for the new flow and editor.

## Submission contract

The current schema requires a ten-character message. The new photo flow explicitly allows an empty note, so it cannot simply reuse that requirement or invent user text to satisfy it.

Add a discriminated submission flow, defaulting absent values to the existing advanced contract for compatibility. For the photo flow accept an optional note of up to 2,000 characters, require exactly one image attachment, and verify server-side that it belongs to the session and is ready. Preserve the existing text rules for advanced reports. Map the photo flow to the problem category and a generated issue title, with the tester's note clearly optional. Test that malformed or unowned attachment IDs cannot bypass the note requirement.

Maintain the existing idempotency behavior so retries cannot duplicate a report. Show errors in the current screen with a retry action and retain the draft. Expired sessions should be recreated and the final image re-uploaded without losing the local edits.

## Implementation order and files

1. Add a shared draft model and the new PhotoFeedbackFlow component under `apps/tv-feedback/src/components/`; route it from `src/app/tv/page.tsx`. Add `src/app/tv/advanced/page.tsx` for FeedbackWizard.
2. Update `ImageAnnotationEditor.tsx` and `src/lib/annotations.ts` for the reference 4 layout, initial tool, selectable object transforms, and saved edit history.
3. Add the reference 3 review and reference 5 receipt, using the actual final file preview. Update `src/lib/copy.ts` and `src/app/styles.css` with consistent branding, safe-area spacing, and phone layout.
4. Update `src/lib/contracts.ts`, the submissions API, and the Linear report mapping for the optional-note photo flow. Reuse the existing private upload/validation worker.
5. Verify the flow and leave the new local route open for the user's phone test.

## Acceptance checks

- iPhone Safari: camera and library selection, picker cancellation, Draw opens reference 4, move/delete/resize marks, Undo/Redo, Thai text entry, Cancel versus Save, rotation and keyboard behavior.
- Review displays the same image that is uploaded, including opaque covers, without selection UI. Edit drawing preserves editable marks.
- Submit with no note and with a note; errors preserve the draft. A retry results in one report with one final image.
- Receipt displays the actual sent thumbnail and distinguishes saved/queued from delivered. Done does not resubmit.
- Advanced report remains usable for video and text-only feedback and retains draft/context when switching.
- Verify 390px phone and desktop layouts, lazy-load the drawing editor only on demand, and check initial page performance has not regressed. Run scoped lint, typecheck, build, contract tests, and browser interaction checks. Record physical iPhone verification separately from desktop browser emulation.
