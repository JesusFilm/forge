# Studio Media workspace

Implement the accepted full browser study in the existing editor (feat-869).
Keep Preview as the initial workspace. Mount the dynamic library on first Media
selection, then hide it when switching back so query and source selection survive.
Hide the existing preview split while browsing; keep player identity, inspector
width and timeline height, and pause playback when entering Media.

Convert Library's dialog wrapper into an embedded browser, preserving capture,
upload, custom component and pack operations. Use an editor-scoped drag context:
native drag data never supplies source identities or arbitrary assets; only the
in-memory browser selection can commit. Timeline maps pointer coordinates to its
current frame scale and track group. Show a clip preview and linked source audio;
drop invokes capture if required, then uses the latest editable document in one
session edit. Canceled/outside drops never capture or edit. Guard pending capture
against language/project/read-only changes and disable duplicate insertion.

Verify the actual insertion boundary with integration tests. Keep library code
and requests deferred behind explicit user intent; measure the mount window and
check initial loading shell remains data/media-free. Preserve real remote preview.
