---
id: "feat-867"
title: "Explore Media and Preview workspace tabs"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui, design]
---

## Scope

Explore Media and Preview tabs before Undo/Redo in the two-row editor header.
The tabs replace the upper preview/inspector region; the timeline stays visible.
Compare a full browser, browser with source viewer and dense list/detail layout.
Search/category/selection and adding sample assets are local prototype actions.
No production editor changes or real project mutations.

## Deliverable

Interactive comparison in the thread visualization directory:
`studio-media-workspace.html`. Preserve current title/history/settings/delivery
hierarchy, remember local selection on tab changes, and keep timeline continuity.
The prototype is a durable design source outside production code; no selection
or implementation is assumed.

## Result

Produced Full browser, Browser and viewer, and List and details. Media/Preview
swap the upper workspace; selection and timeline survive tab changes. Sample
search, empty results, category changes, selection, add and undo/redo work locally.
Source video additions also represent their associated audio. The optional design
control compares staying in Media with switching to Preview after insertion.

Browser verification exercised tabs, search, source selection, audio insertion
and undo. Desktop stages remain 800px high; source/list stages at the 320px
breakpoint are 1450px high without horizontal overflow (271px inner content).
No console warnings/errors. The fragment has no fetch/WebSocket/XHR, external
media or project writes; production code and loading performance are unchanged.
The temporary hosted verification copy was removed after review.

Decision remains open. The main design question is whether selection should
share the workspace with a source viewer or give the whole area to browsing.
Keep timeline continuity and media selection persistence in either implementation.
