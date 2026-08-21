export const supportedAdminLocales = ["en", "es"] as const

export type AdminLocale = (typeof supportedAdminLocales)[number]

export const adminMessages = {
  en: {
    metadata: {
      title: "Forge Admin",
      description: "JesusFilm Forge admin app",
    },
    common: {
      localeLabel: "Language",
      locales: {
        en: "English",
        es: "Español",
      },
      operatorNotes: "Operator Notes",
      premiumStubLabel: "Premium stub wired for future data",
      fieldGuide: "FIELD_GUIDE",
      searchPlaceholder: "Open route palette",
      searchPalettePrompt: "Navigate routes, tools, and editorial surfaces",
      navigate: "Navigate",
      quickActions: "Quick Actions",
      readOnly: "Read-only",
      openCommandPalette: "Open command palette",
      closeCommandPalette: "Close command palette",
      helpUnavailable: "Help is not available yet",
      navigationLoading: "Loading route...",
      context: "Context",
      paletteContext:
        "This palette is shared across the entire dashboard shell and uses the same route registry as the sidebar so future pages stay synchronized automatically.",
      escape: "ESC",
      commandShortcut: "⌘K",
      infoStrip: {
        ingestionActive: "INGESTION PIPELINE: ACTIVE",
        uptime: "UPTIME: 99.98%",
        region: "REGION: US-EAST-1 (PROD)",
      },
      shell: {
        brandName: "Forge Editorial",
        brandTag: "JFP Admin",
        fallbackPrincipal: "system@forge",
        version: "v1.0.0-ui",
      },
      access: {
        noAccessTitle: "Access Required",
        noAccessDescription:
          "Your account does not currently have permissions for the admin dashboard. Contact an administrator to grant access.",
        roleLabel: "Current role",
      },
      statuses: {
        published: "Published",
        archived: "Archived",
        failed: "Failed",
        draft: "Draft",
        healthy: "Healthy",
        running: "Running",
        action: "Action",
        review: "Review",
        pending: "Pending",
        verified: "Verified",
        queued: "Queued",
        disable: "Disable",
        resolved: "Resolved",
        passed: "Passed",
        succeeded: "Succeeded",
        retrying: "Retrying",
      },
    },
    nav: {
      sections: {
        overview: "Overview",
        content: "Content",
        system: "System",
      },
      items: {
        dashboard: {
          label: "Dashboard",
          description: "Operational overview and active sync surfaces.",
        },
        experiences: {
          label: "Experiences",
          description: "Interactive experience index and publishing state.",
        },
        videos: {
          label: "Videos",
          description: "Video library, sources, and dub coverage.",
        },
        media: {
          label: "Media",
          description: "Shared asset inventory and review queues.",
        },
        languages: {
          label: "Languages",
          description: "Reference data and locale coverage.",
        },
        systemStatus: {
          label: "Core Sync",
          description: "Sync health and freshness.",
        },
        workflows: {
          label: "Workflows",
          description: "Durable runs, retries, and queue state.",
        },
        embeddings: {
          label: "Embeddings",
          description: "Vector coverage, freshness, and indexing status.",
        },
        search: {
          label: "Search",
          description: "Retrieval quality and trace inspection.",
        },
        users: {
          label: "Users",
          description: "Permissions, invites, and role posture.",
        },
        userPlaylistModeration: {
          label: "Playlist moderation",
          description: "Privacy-redacted reports and playlist actions.",
        },
        partnerKeys: {
          label: "Partner API keys",
          description: "Issued partner bearer tokens and revocation status.",
        },
        mcp: {
          label: "MCP",
          description: "Admin MCP endpoints, OAuth scopes, and agent skills.",
        },
        settings: {
          label: "Settings",
          description: "Keys, providers, and environment controls.",
        },
      },
    },
    home: {
      title: "Forge Admin",
      description:
        "Scaffolding in place. See docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.",
      links: {
        login: "/api/auth/login",
        dashboard: "/dashboard",
        systemStatus: "/dashboard/system-status",
        health: "/api/health",
      },
    },
    login: {
      brandName: "JesusFilm",
      hero: "Sign in with your JesusFilm account.",
      labels: {
        welcomeBack: "Sign in to continue",
        emailAddress: "Email address",
        password: "Password",
        divider: "OR",
      },
      destination: {
        context: "Continuing to {destination}",
        helper: "You are signing in to access {destination}.",
        defaultName: "Forge administration panel",
      },
      placeholders: {
        email: "admin@example.com",
        password: "••••••••••••",
      },
      actions: {
        checkAccessStatus: "Check access status",
        continue: "Continue",
        signingIn: "Signing in…",
        continueWith: "Continue with {provider}",
        continueToAdmin: "Continue to admin",
        requestAccess: "Request access",
        requestingAccess: "Requesting access…",
        signInAgain: "Sign in again",
        tryDifferentAccount: "Try a different account",
      },
      providers: {
        facebook: "Facebook",
        google: "Google",
        apple: "Apple",
        okta: "Okta",
      },
      errors: {
        forbidden: "You're signed in, but Admin access has not been approved.",
        invalidCredentials: "Invalid email or password",
        requestAccessFailed: "Access request failed. Try signing in again.",
      },
      access: {
        accountLabel: "You are signed in as",
        approved:
          "Access has been approved. Continue to sign in again and enter the dashboard.",
        available:
          "You're signed in, but Admin access has not been approved. Request access and an administrator will review your account.",
        description:
          "This account is authenticated, but it has not been approved for Forge Admin.",
        pending:
          "You're signed in, but Admin access has not been approved. An administrator still needs to approve your account.",
        requested:
          "Access requested. An administrator must approve your account before you can enter the dashboard.",
        title: "Admin access required",
        unavailable:
          "No active access request was found. Sign in again to check your access.",
      },
    },
    pages: {
      dashboard: {
        title: "System Overview",
        description: "Real-time status of content delivery and sync pipelines.",
        action: "Run Manual Sync",
        actionUnavailable: "Manual sync starts from Core Sync.",
        metrics: [
          {
            label: "Experiences",
            value: "184",
            delta: "+12",
            footer: "THIS_WEEK",
          },
          {
            label: "Drafts",
            value: "23",
            delta: "+3",
            footer: "PENDING_REVIEW",
          },
          {
            label: "Videos",
            value: "4,812",
            delta: "+218",
            footer: "ENCODED_TOTAL",
          },
          { label: "Last Sync", value: "2h 14m", footer: "SYNC_SUCCESSFUL" },
          {
            label: "Failed Workflows",
            value: "2",
            footer: "ACTION_REQUIRED",
            accent: "danger",
          },
        ],
        activitySection: {
          title: "Activity Feed",
          meta: "LATEST_50_EVENTS",
          columns: ["User", "Action", "Target", "Timestamp"],
          rows: [
            {
              user: "Marcus Chen",
              actionLabel: "Published",
              actionTone: "success",
              target: "exp_8829_autumn_campaign",
              timestamp: "14:22:10",
            },
            {
              user: "System Scheduler",
              actionLabel: "Archived",
              actionTone: "muted",
              target: "wf_revision_prune_nightly",
              timestamp: "13:58:41",
            },
            {
              user: "Nina Santos",
              actionLabel: "Failed",
              actionTone: "danger",
              target: "video_sync_batch_204",
              timestamp: "13:51:09",
            },
            {
              user: "A. Thompson",
              actionLabel: "Draft",
              actionTone: "warning",
              target: "exp_jfilm_remastered",
              timestamp: "13:14:02",
            },
          ],
        },
        signalSection: {
          title: "System Signals",
          meta: "PATTERN_MATRIX",
          insights: [
            {
              label: "Publishing Throughput",
              value: "18 / hr",
              detail:
                "Editorial publish velocity remains above the 7-day median.",
            },
            {
              label: "Workflow Success",
              value: "97.8%",
              detail:
                "Retry pressure is isolated to two video enrichment jobs.",
            },
            {
              label: "Permission Drift",
              value: "0",
              detail:
                "No access mismatches detected across ADMIN and EDITOR tiers.",
            },
            {
              label: "Sync Gap",
              value: "2h 14m",
              detail:
                "Core delta refresh is within the current production tolerance.",
            },
          ],
        },
        syncSection: {
          title: "Sync Surfaces",
          meta: "LIVE_STATE",
          panels: [
            {
              title: "Core Video Sync",
              lag: "2h 14m",
              stateLabel: "Healthy",
              stateTone: "success",
            },
            {
              title: "Experience Embeddings",
              lag: "18m",
              stateLabel: "Running",
              stateTone: "info",
            },
            {
              title: "Workflow Dead Letter",
              lag: "2 items",
              stateLabel: "Action",
              stateTone: "danger",
            },
          ],
          drilldown: "Drilldown",
        },
        operatorRail: {
          notes:
            "This overview is tuned as the premium operator landing surface: dense metrics, low-noise motion, and direct links into the systems that need intervention.",
          chips: [
            { label: "Mode", value: "OVERVIEW_CANVAS" },
            { label: "Reference", value: "STITCH_DASHBOARD_FINAL" },
            { label: "Surface", value: "EDITORIAL_OPERATIONS" },
          ],
        },
        watchlist: {
          title: "Watchlist",
          meta: "ACTION_WINDOW",
          items: [
            {
              title: "Failed workflow retry bundle",
              meta: "wf_7061 / 2 items / 14:36",
              detail:
                "Retry after upstream media availability check completes.",
              statusLabel: "Review",
              statusTone: "warning",
            },
            {
              title: "Core sync lag threshold",
              meta: "threshold=4h / currently 2h 14m",
              detail: "Below pager level, but still visible to operations.",
              statusLabel: "Healthy",
              statusTone: "success",
            },
          ],
        },
      },
      experiences: {
        eyebrow: "Content / Experiences",
        title: "Experiences",
        description:
          "Manage interactive spiritual journeys and storytelling sequences.",
        actions: {
          filter: "Filter",
          filterUnavailable: "Experience filters are not available yet.",
          primary: "New Experience",
        },
        modal: {
          title: "Create Experience",
          description:
            "Create a new draft experience with an initial locale and slug.",
          titleLabel: "Title",
          localeLabel: "Locale",
          slugLabel: "Slug",
          routeTemplateLabel: "Route template",
          routeTemplateHelp:
            "Enable route video blocks for experiences that render dynamic video routes.",
          cancel: "Cancel",
          submit: "Create Experience",
          localeHelp: "Use a BCP-47 code (for example: en, es, fr).",
          noPermission:
            "You do not have permission to create experiences. Contact an administrator to grant access.",
          createFailed: "Unable to create experience. Please try again.",
        },
        empty: {
          title: "No experiences yet",
          description:
            "Create the first draft experience to start building locale content.",
        },
      },
      videos: {
        eyebrow: "Index / Videos",
        title: "Video Library",
        description:
          "Review the catalog and dub coverage across {total} titles.",
        infoStrip: {
          items: ["INGESTION PIPELINE: ACTIVE", "MUX EDGE ONLINE"],
          trailing: "REGION: US-EAST-1 (PROD)",
        },
        actions: {
          filter: "Filter",
          filterUnavailable: "Video filters are not available yet.",
          primary: "Add manual video",
          primaryUnavailable: "Manual video creation is not available yet.",
          rowActionsUnavailable: "Video row actions are not available yet.",
        },
        collection: {
          clear: "Clear collection filter",
          childCount: "{count} child videos",
          missing: "Collection not found",
          title: "Collection filter",
        },
        detail: {
          close: "Back to video library",
          count: "{count} records",
          eyebrow: "Video detail",
          openVisitor: "Open visitor page",
        },
        search: {
          label: "Search videos",
          placeholder: "Search videos, IDs, languages...",
          submit: "Search",
          clear: "Clear",
          active: 'Filtered by "{query}"',
        },
        filters: {
          categoryLabel: "Filter by video type",
          languageLabel: "Filter by dubbed language",
          languageSearchPlaceholder: "Filter languages...",
          languageNoResults: "No matching languages",
          allLanguages: "All languages",
          loading: "Thinking...",
          ready: "Video filters ready",
        },
        tabs: {
          all: "All",
          collections: "Collections",
          episodes: "Single episodes",
          features: "Features",
          shortFilms: "Short films",
          series: "Series",
        },
        sort: {
          label: "Sort videos",
          options: {
            recent: "Recently updated",
            oldest: "Oldest updated",
            created: "Recently created",
            createdOldest: "Oldest created",
          },
        },
        coverage: {
          languagesDubbed: "languages dubbed",
          noLanguages: "No dubbed languages",
          overflow: "+{count}",
        },
        summary: {
          total: "Active videos",
          visible: "Visible rows",
          page: "Page",
          query: "Query",
          queryAll: "All videos",
        },
        table: {
          title: "Video Library",
          meta: "SEARCHABLE_ROWS / TYPE_LABELS / VISITOR_LINKS",
          columns: ["Thumbnail", "Video Details", "Source", "Dubs", "Updated"],
          empty: "No active videos found.",
          emptySearch: "No active videos match this search or filter.",
          openCollectionLabel: "Filter by collection",
          openDetailsLabel: "Open video detail",
          openVisitorLabel: "Open visitor-facing video page",
          noVisitorLinkLabel: "No public watch link available",
          pagination: {
            summary: "Showing {start}-{end} of {total}",
            page: "Page {current} of {count}",
            previous: "Previous",
            next: "Next",
          },
          rows: [
            {
              title: "Neon Genesis: The Digital Divide",
              id: "vid_8829_x_alpha_92",
              sourceLabel: "Mux Edge",
              sourceTone: "info",
              dubs: "EN, ES, FR",
              updated: "2023.10.24 14:02",
              duration: "04:22",
            },
            {
              title: "Stories From The Upper Room",
              id: "vid_6611_upper_room_core",
              sourceLabel: "Core Sync",
              sourceTone: "success",
              dubs: "EN, PT, HI",
              updated: "2023.10.24 09:11",
              duration: "12:47",
            },
            {
              title: "A City On A Hill Trailer",
              id: "vid_2207_city_hill_trailer",
              sourceLabel: "Manual",
              sourceTone: "warning",
              dubs: "EN",
              updated: "2023.10.23 17:26",
              duration: "01:53",
            },
          ],
        },
        signals: {
          title: "Media Signals",
          meta: "CATALOG_HEALTH",
          insights: [
            {
              label: "Mux-backed Assets",
              value: "88%",
              detail:
                "The catalog is predominantly streaming-native and operationally consistent.",
            },
            {
              label: "Dub Coverage",
              value: "3.7",
              detail:
                "Average audio language count across the current visible set.",
            },
            {
              label: "Manual Intake",
              value: "14",
              detail:
                "Manual uploads remain a small but visible operational pathway.",
            },
            {
              label: "Freshness Window",
              value: "6h",
              detail:
                "Median time since the latest sync for the active rows on screen.",
            },
          ],
        },
        rail: {
          notes:
            "The video library now follows the same component grammar as the rest of the admin shell while preserving the heavier table silhouette from the Stitch final screen.",
          chips: [
            { label: "Source", value: "VIDEOS_FINAL" },
            { label: "Pattern", value: "THUMBNAIL_TABLE" },
            { label: "Primary CTA", value: "ADD_MANUAL_VIDEO" },
          ],
        },
      },
      systemStatus: {
        eyebrow: "System / Core Sync",
        title: "Core Sync Dashboard",
        description: "Core sync health and freshness.",
        action: "Start Sync",
        metrics: [
          { label: "Live Connectors", value: "4", footer: "ACTIVE_NOW" },
          { label: "Last Success", value: "14:21", footer: "UTC" },
          { label: "Avg Lag", value: "2h 05m", footer: "ACROSS_SURFACES" },
          {
            label: "Exceptions",
            value: "2",
            footer: "REQUIRES_REVIEW",
            accent: "danger",
          },
        ],
        matrix: {
          title: "Sync State",
          meta: "CORE_ENTITY_DRIFT_VIEW",
          columns: ["Data set", "Status", "Last run"],
          rows: [
            {
              entity: "Videos",
              source: "core.video",
              statusLabel: "Healthy",
              statusTone: "success",
              lag: "2h 14m",
              throughput: "218 changed",
            },
            {
              entity: "Languages",
              source: "core.language",
              statusLabel: "Healthy",
              statusTone: "success",
              lag: "38m",
              throughput: "4 changed",
            },
            {
              entity: "Countries",
              source: "core.country",
              statusLabel: "Review",
              statusTone: "warning",
              lag: "5h 03m",
              throughput: "2 changed",
            },
            {
              entity: "Keywords",
              source: "core.keyword",
              statusLabel: "Retrying",
              statusTone: "info",
              lag: "1h 07m",
              throughput: "41 changed",
            },
          ],
        },
        incidents: {
          title: "Incident Window",
          meta: "LAST_24_HOURS",
          items: [
            {
              title: "Country reference lag above threshold",
              meta: "connector=core.country / lag=5h 03m",
              detail:
                "Visible drift is still below hard block level, but now outside the preferred sync window.",
              statusLabel: "Review",
              statusTone: "warning",
            },
            {
              title: "Keyword retry bundle in progress",
              meta: "connector=core.keyword / batch=41",
              detail:
                "Retry path is healthy and currently replaying transient upstream failures.",
              statusLabel: "Running",
              statusTone: "info",
            },
            {
              title: "Video delta ingest settled",
              meta: "connector=core.video / completed 14:21",
              detail:
                "No downstream data integrity issues detected after the last run.",
              statusLabel: "Healthy",
              statusTone: "success",
            },
          ],
        },
        telemetry: {
          title: "Telemetry Panels",
          meta: "PRODUCTION_LENS",
          insights: [
            {
              label: "Connector Health",
              value: "4 / 4",
              detail:
                "All configured sync surfaces are reachable from the admin runtime.",
            },
            {
              label: "Retry Budget",
              value: "82%",
              detail:
                "Healthy retry headroom remains before escalation thresholds are crossed.",
            },
            {
              label: "Dead Letters",
              value: "0",
              detail:
                "No sync payloads are currently stranded in dead-letter handling.",
            },
            {
              label: "Derived Writes",
              value: "259",
              detail:
                "Embedding and post-sync derivative updates completed in the current cycle.",
            },
          ],
        },
        rail: {
          notes:
            "This route now acts as the operational control plane placeholder for the future `systemStatus` GraphQL surface rather than a dead-end placeholder page.",
          chips: [
            { label: "Reference", value: "CORE_SYNC_DASHBOARD" },
            { label: "Surface", value: "OPS_MONITORING" },
            { label: "Mode", value: "UI_READY_FOR_LIVE_DATA" },
          ],
        },
      },
      workflows: {
        eyebrow: "System / Workflows",
        title: "Workflows",
        description:
          "Track durable job execution, retries, and queued operator tasks.",
        cards: [
          { label: "Active", value: "18", footer: "RUNNING_OR_QUEUED" },
          { label: "Completed", value: "124", footer: "RECENT_RUNS" },
          { label: "Failed", value: "3", footer: "LAST_RUN_ERRORS" },
        ],
        queueTitle: "Workflow Queue",
        queueMeta: "RUNS / RETRIES / FAILURES",
        queue: [
          {
            title: "experience-embedding-backfill",
            meta: "wf_7001 / batch 08 / 14:21:09",
            detail:
              "Long-running backfill partition currently consuming the largest worker slice.",
            statusLabel: "Running",
            statusTone: "info",
          },
          {
            title: "core-sync-videos",
            meta: "wf_7000 / delta / 14:18:33",
            detail:
              "Queued behind the embedding batch to preserve throughput discipline.",
            statusLabel: "Queued",
            statusTone: "warning",
          },
          {
            title: "revision-prune",
            meta: "wf_6994 / nightly / 03:10:00",
            detail: "Completed inside the expected retention window.",
            statusLabel: "Succeeded",
            statusTone: "success",
          },
        ],
        notes:
          "Workflows are modeled as a queue-first operational surface: durable jobs, retry posture, and clear signals for intervention without over-decorating the page.",
        chips: [
          { label: "Pattern", value: "QUEUE_AND_SIGNAL" },
          { label: "Reference", value: "WORKFLOWS_LIST" },
          { label: "Primary Lens", value: "DURABLE_EXECUTION" },
        ],
        insightTitle: "Workflow Signals",
        insightMeta: "EXECUTION_POSTURE",
        insights: [
          {
            label: "Throughput",
            value: "124 / hr",
            detail: "Combined completion rate across the current worker pool.",
          },
          {
            label: "Retry Depth",
            value: "1.3x",
            detail:
              "Average retry depth remains below the current intervention threshold.",
          },
        ],
      },
      embeddings: {
        eyebrow: "System / Embeddings",
        title: "Embeddings Overview",
        description:
          "Monitor vector coverage, backfill state, and retrieval readiness.",
        cards: [
          {
            label: "Embedded Rows",
            value: "128k",
            footer: "EXPERIENCE_LOCALES",
          },
          { label: "Missing", value: "842", footer: "NULL_VECTORS" },
          { label: "Index Dim", value: "1536", footer: "PGVECTOR_HNSW" },
        ],
        queueTitle: "Embedding Work Queue",
        queueMeta: "BACKFILLS / INDEX_HEALTH / FRESHNESS",
        queue: [
          {
            title: "experienceLocale.embedding backfill",
            meta: "job_2381 / locale=en / 14:04:19",
            detail:
              "Primary backfill lane is currently focused on recent editorial edits.",
            statusLabel: "Running",
            statusTone: "info",
          },
          {
            title: "semantic audit / stale vectors",
            meta: "job_2380 / tolerance=7d",
            detail:
              "Audit pass isolates stale embeddings before they affect retrieval quality.",
            statusLabel: "Queued",
            statusTone: "warning",
          },
          {
            title: "index health snapshot",
            meta: "job_2374 / nightly",
            detail:
              "Latest snapshot reports no index fragmentation requiring manual action.",
            statusLabel: "Passed",
            statusTone: "success",
          },
        ],
        notes:
          "Embeddings are framed as infrastructure, not decoration: vector coverage, backfill movement, and the operational envelope needed for trustworthy semantic features.",
        chips: [
          { label: "Reference", value: "EMBEDDINGS_OVERVIEW" },
          { label: "Surface", value: "VECTOR_OPERATIONS" },
          { label: "Schema", value: "EXPERIENCE_LOCALE" },
        ],
        insightTitle: "Embedding Signals",
        insightMeta: "VECTOR_QUALITY",
        insights: [
          {
            label: "Recall Delta",
            value: "+4.1%",
            detail: "Measured lift after the latest embedding refresh window.",
          },
          {
            label: "Null Vector Risk",
            value: "0.6%",
            detail:
              "Small remaining tail of locales still awaiting vector generation.",
          },
        ],
      },
      search: {
        eyebrow: "",
        title: "Search",
        description: "Monitor recent search requests, clicks, and latency.",
        cards: [
          { label: "Median Latency", value: "87ms", footer: "TOP_10_RESULTS" },
          { label: "Queries / Hr", value: "1.2k", footer: "EDITOR_TRAFFIC" },
          { label: "Recall Checks", value: "98.1%", footer: "SAMPLED_PAIRS" },
        ],
        queueTitle: "Search Trace Queue",
        queueMeta: "QUERIES / RESOLUTION / RISK",
        queue: [
          {
            title: "forgiveness and restoration",
            meta: "q_1902 / locale=en / k=10",
            detail:
              "Resolved set aligns with expected published experiences for the topic cluster.",
            statusLabel: "Resolved",
            statusTone: "success",
          },
          {
            title: "cross-locale duplicate drift",
            meta: "q_1891 / locale=pt-BR",
            detail:
              "Potential duplicate hydration path worth review before launch broadening.",
            statusLabel: "Review",
            statusTone: "warning",
          },
          {
            title: "low-score hydration failure",
            meta: "q_1877 / trace=af3d19",
            detail:
              "Search returned IDs, but hydration path lost a row due to stale metadata.",
            statusLabel: "Failed",
            statusTone: "danger",
          },
        ],
        notes:
          "The search route is positioned as an analysis surface for retrieval quality rather than a consumer-facing search page, so the emphasis stays on traces, failures, and confidence windows.",
        chips: [
          { label: "Reference", value: "SEMANTIC_SEARCH_RESULTS" },
          { label: "Mode", value: "TRACE_INSPECTION" },
          { label: "Signal", value: "QUALITY_AND_RECALL" },
        ],
        insightTitle: "Search Signals",
        insightMeta: "RETRIEVAL_CONFIDENCE",
        insights: [
          {
            label: "Median Score",
            value: "0.83",
            detail:
              "Healthy confidence level for the current benchmark queries.",
          },
          {
            label: "Hydration Success",
            value: "99.2%",
            detail:
              "Most traces resolve cleanly through the loader and Prisma path.",
          },
        ],
      },
      users: {
        eyebrow: "System / Users",
        title: "Users & Permissions",
        description:
          "Review role distribution, access boundaries, and pending operator invites.",
        cards: [
          { label: "Admins", value: "14", footer: "GLOBAL_OVERRIDE" },
          { label: "Editors", value: "63", footer: "CONTENT_OPERATORS" },
          { label: "Pending Invites", value: "5", footer: "AWAITING_ACCEPT" },
        ],
        queueTitle: "Access Review Queue",
        queueMeta: "INVITES / PRINCIPALS / ROLE_CHANGES",
        queue: [
          {
            title: "nina.santos@jesusfilm.org",
            meta: "invite / editor / expires in 2d",
            detail: "Awaiting acceptance before editorial work can begin.",
            statusLabel: "Pending",
            statusTone: "warning",
          },
          {
            title: "system workflow principal",
            meta: "SYSTEM / background jobs",
            detail:
              "Verified to keep workflow execution separate from human operator permissions.",
            statusLabel: "Verified",
            statusTone: "success",
          },
          {
            title: "legacy viewer import",
            meta: "batch 04 / 62 accounts",
            detail:
              "Pending migration sequencing after auth hardening completes.",
            statusLabel: "Queued",
            statusTone: "info",
          },
        ],
        notes:
          "Permissions surfaces need clarity over decoration, so the premium treatment here focuses on dense trust signals, role visibility, and easy scanning of access-related risk.",
        chips: [
          { label: "Reference", value: "USERS_AND_PERMISSIONS" },
          { label: "Surface", value: "ACCESS_CONTROL" },
          { label: "Model", value: "ROLE_PLUS_ABAC" },
        ],
        insightTitle: "Permission Signals",
        insightMeta: "ACCESS_HEALTH",
        insights: [
          {
            label: "Invite Acceptance",
            value: "91%",
            detail:
              "Most pending invites are resolved within the expected onboarding window.",
          },
          {
            label: "Role Drift",
            value: "0",
            detail:
              "No mismatches detected against the current permission matrix.",
          },
        ],
      },
      partnerKeys: {
        eyebrow: "System / Partner API Keys",
        title: "Partner API keys",
        description:
          "Issued partner bearer tokens, last-used signal, and revocation status.",
        emptyTitle: "No partner keys issued yet",
        emptyDescription:
          "Issue a key via CLI: pnpm --filter @forge/admin partner-keys create --name=[label] --owner-email=[contact]",
        statusActive: "Active",
        statusRevoked: "Revoked",
        unknownUser: "unknown",
        neverUsed: "never",
        columns: {
          keyId: "Key ID",
          name: "Name",
          owner: "Owner",
          status: "Status",
          lastUsed: "Last used",
          createdAt: "Created",
          createdBy: "Created by",
          revokedBy: "Revoked by",
        },
      },
      playlistModeration: {
        eyebrow: "System / Trust & Safety",
        title: "Playlist moderation",
        description:
          "Review privacy-redacted reports and take audited playlist actions.",
        queueTitle: "Reported playlists",
        queueMeta: "PRIVACY_REDACTED / RETENTION_ENFORCED",
        emptyTitle: "No reports match this filter",
        emptyDescription:
          "New reports will appear here while retained moderation detail remains available.",
        nextPage: "Next page",
        filters: {
          category: "Report category",
          allCategories: "All categories",
          apply: "Apply",
          clear: "Clear",
        },
        categories: {
          INAPPROPRIATE_CONTENT: "Inappropriate content",
          MISLEADING_OR_SPAM: "Misleading or spam",
          COPYRIGHT_OR_RIGHTS: "Copyright or rights",
          PRIVACY_OR_PERSONAL_DATA: "Privacy or personal data",
          OTHER_SAFETY: "Other safety concern",
        },
        queue: {
          playlistLabel: "Playlist",
          reportCount: "report",
          reportsCount: "reports",
          reportedAt: "Reported",
          details: {
            AVAILABLE: "Detail available",
            ABSENT: "No detail supplied",
            EXPIRED: "Detail expired",
            UNAVAILABLE: "Detail unavailable",
          },
          categories: {
            INAPPROPRIATE_CONTENT: "Inappropriate content",
            MISLEADING_OR_SPAM: "Misleading or spam",
            COPYRIGHT_OR_RIGHTS: "Copyright or rights",
            PRIVACY_OR_PERSONAL_DATA: "Privacy or personal data",
            OTHER_SAFETY: "Other safety concern",
          },
          actions: {
            block: "Block",
            restore: "Restore",
            blockTitle: "Block this playlist?",
            restoreTitle: "Restore this playlist?",
            blockDescription:
              "The public playlist link will stop resolving. Choose the audited policy reason before confirming.",
            restoreDescription:
              "The separate moderation block will be cleared. Owner eligibility and sharing rules still apply.",
            reason: "Reason",
            selectReason: "Select a reason",
            confirmBlock: "Confirm block",
            confirmRestore: "Confirm restore",
            cancel: "Cancel",
            working: "Working…",
            blocked: "Playlist blocked",
            restored: "Playlist restored",
            failed: "Moderation action failed. Try again.",
          },
          blockReasons: {
            ABUSE: "Abuse",
            COPYRIGHT: "Copyright",
            PRIVACY: "Privacy",
            SAFETY: "Safety",
            SPAM: "Spam",
            OTHER_POLICY: "Other policy",
          },
          restoreReasons: {
            REVIEW_CLEARED: "Review cleared",
            APPEAL_APPROVED: "Appeal approved",
            ERROR_CORRECTED: "Error corrected",
          },
        },
      },
      settings: {
        eyebrow: "System / Settings",
        title: "Settings & API Keys",
        description:
          "Manage operational credentials, environment posture, and integration guardrails.",
        cards: [
          { label: "Active Keys", value: "12", footer: "ROTATION_TRACKED" },
          { label: "Expiring Soon", value: "2", footer: "NEXT_14_DAYS" },
          { label: "Providers", value: "4", footer: "SSO_ENABLED" },
        ],
        queueTitle: "Configuration Queue",
        queueMeta: "KEYS / PROVIDERS / ROTATION",
        queue: [
          {
            title: "core sync token",
            meta: "rotates in 11d / owner=platform",
            detail:
              "Healthy rotation lead time with no emergency action required.",
            statusLabel: "Healthy",
            statusTone: "success",
          },
          {
            title: "staging social auth review",
            meta: "facebook / google / apple / okta",
            detail:
              "Provider audit staged ahead of the broader environment promotion.",
            statusLabel: "Review",
            statusTone: "warning",
          },
          {
            title: "deprecated test key",
            meta: "last used 2026-03-30",
            detail:
              "Removal is recommended before the next release branch is cut.",
            statusLabel: "Disable",
            statusTone: "danger",
          },
        ],
        notes:
          "Settings pages become premium when they reduce ambiguity. The emphasis here is clear rotation posture, provider visibility, and operational confidence rather than ornamental controls.",
        chips: [
          { label: "Reference", value: "SETTINGS_AND_API_KEYS" },
          { label: "Mode", value: "CONFIGURATION_GUARDRAILS" },
          { label: "Owner", value: "PLATFORM_OPERATIONS" },
        ],
        insightTitle: "Configuration Signals",
        insightMeta: "OPS_POSTURE",
        insights: [
          {
            label: "Rotation Compliance",
            value: "83%",
            detail:
              "Most credential classes are already inside the preferred rotation window.",
          },
          {
            label: "Provider Coverage",
            value: "4 / 4",
            detail:
              "All planned SSO providers are represented in the current posture view.",
          },
        ],
      },
      languages: {
        eyebrow: "Content / Languages",
        title: "Language Library",
        description:
          "Review reference metadata, country links, and content coverage across {total} languages.",
        cards: [
          { label: "Languages", value: "212", footer: "REFERENCE_ROWS" },
          { label: "Countries", value: "247", footer: "ISO_MAPPED" },
          { label: "Locales In Use", value: "89", footer: "PUBLISHED_CONTENT" },
        ],
        queueTitle: "Locale Review Queue",
        queueMeta: "LANGUAGES / COUNTRIES / COVERAGE",
        queue: [
          {
            title: "es-419",
            meta: "content coverage 81% / synced 2h ago",
            detail:
              "Healthy multilingual surface with strong content availability.",
            statusLabel: "Healthy",
            statusTone: "success",
          },
          {
            title: "ar-EG",
            meta: "new locale proposal / review pending",
            detail:
              "Awaiting editorial sign-off before exposure in the broader content model.",
            statusLabel: "Pending",
            statusTone: "warning",
          },
          {
            title: "country backfill drift",
            meta: "2 unmapped core ids",
            detail:
              "Small reference-data mismatch isolated to the latest upstream import.",
            statusLabel: "Action",
            statusTone: "danger",
          },
        ],
        notes:
          "Reference data pages matter because they underpin every localized editorial surface. The refined version keeps them dense, legible, and structured for quick trust checks.",
        chips: [
          { label: "Reference", value: "LANGUAGES_REFERENCE_DATA" },
          { label: "Surface", value: "LOCALE_FOUNDATION" },
          { label: "Sync", value: "CORE_BACKED" },
        ],
        insightTitle: "Locale Signals",
        insightMeta: "COVERAGE_HEALTH",
        insights: [
          {
            label: "Coverage Depth",
            value: "89 locales",
            detail:
              "Published content currently spans a meaningful multilingual footprint.",
          },
          {
            label: "Reference Drift",
            value: "2 ids",
            detail:
              "Only a minimal amount of core reference cleanup remains visible.",
          },
        ],
      },
      media: {
        eyebrow: "Content / Media",
        title: "Media Library",
        description:
          "Browse reusable assets, ingestion status, and downstream availability.",
        cards: [
          { label: "Assets", value: "9,481", footer: "INDEXED_FILES" },
          { label: "Pending Review", value: "17", footer: "EDITOR_QUEUE" },
          { label: "Storage Buckets", value: "3", footer: "ACTIVE_TARGETS" },
        ],
        queueTitle: "Media Operations Queue",
        queueMeta: "ASSETS / THUMBNAILS / QUALITY",
        queue: [
          {
            title: "hero-stills / easter-campaign",
            meta: "collection / 24 assets",
            detail:
              "Published collection is available to downstream editorial surfaces.",
            statusLabel: "Published",
            statusTone: "success",
          },
          {
            title: "mux thumbnail refresh",
            meta: "asset batch / started 14:02",
            detail:
              "Thumbnail generation remains in progress for the current ingest set.",
            statusLabel: "Running",
            statusTone: "info",
          },
          {
            title: "duplicate upload detection",
            meta: "hash collision / 3 files",
            detail:
              "Potential asset duplication surfaced by the latest scan and needs review.",
            statusLabel: "Review",
            statusTone: "warning",
          },
        ],
        notes:
          "Media library polish comes from discipline: clear asset state, precise counts, and enough structure to make the library feel trustworthy before any richer browsing tools are added.",
        chips: [
          { label: "Reference", value: "MEDIA_LIBRARY" },
          { label: "Pattern", value: "ASSET_OPERATIONS" },
          { label: "Mode", value: "CURATION_READY" },
        ],
        insightTitle: "Asset Signals",
        insightMeta: "LIBRARY_POSTURE",
        insights: [
          {
            label: "Asset Freshness",
            value: "94%",
            detail:
              "Most assets were synced or reviewed inside the current freshness window.",
          },
          {
            label: "Review Load",
            value: "17",
            detail: "Pending assets are within a manageable review queue size.",
          },
        ],
      },
    },
  },
  es: {
    metadata: {
      title: "Forge Admin",
      description: "Aplicación administrativa de JesusFilm Forge",
    },
    common: {
      localeLabel: "Idioma",
      locales: {
        en: "English",
        es: "Español",
      },
      operatorNotes: "Notas del operador",
      premiumStubLabel: "Superficie premium lista para datos futuros",
      fieldGuide: "GUIA_DE_CAMPO",
      searchPlaceholder: "Abrir paleta de rutas",
      searchPalettePrompt:
        "Navegar rutas, herramientas y superficies editoriales",
      navigate: "Navegar",
      quickActions: "Acciones rápidas",
      readOnly: "Solo lectura",
      openCommandPalette: "Abrir paleta de comandos",
      closeCommandPalette: "Cerrar paleta de comandos",
      helpUnavailable: "La ayuda aun no esta disponible",
      navigationLoading: "Cargando ruta...",
      context: "Contexto",
      paletteContext:
        "Esta paleta se comparte en todo el panel y usa el mismo registro de rutas que la barra lateral para que las futuras páginas permanezcan sincronizadas automáticamente.",
      escape: "ESC",
      commandShortcut: "⌘K",
      infoStrip: {
        ingestionActive: "CANAL DE INGESTA: ACTIVO",
        uptime: "DISPONIBILIDAD: 99.98%",
        region: "REGION: US-EAST-1 (PROD)",
      },
      shell: {
        brandName: "Forge Editorial",
        brandTag: "JFP Admin",
        fallbackPrincipal: "system@forge",
        version: "v1.0.0-ui",
      },
      access: {
        noAccessTitle: "Acceso requerido",
        noAccessDescription:
          "Tu cuenta no tiene permisos para el panel administrativo. Contacta a un administrador para que te otorgue acceso.",
        roleLabel: "Rol actual",
      },
      statuses: {
        published: "Publicado",
        archived: "Archivado",
        failed: "Fallido",
        draft: "Borrador",
        healthy: "Saludable",
        running: "En curso",
        action: "Accion",
        review: "Revisar",
        pending: "Pendiente",
        verified: "Verificado",
        queued: "En cola",
        disable: "Desactivar",
        resolved: "Resuelto",
        passed: "Aprobado",
        succeeded: "Exitoso",
        retrying: "Reintentando",
      },
    },
    nav: {
      sections: {
        overview: "Resumen",
        content: "Contenido",
        system: "Sistema",
      },
      items: {
        dashboard: {
          label: "Panel",
          description:
            "Resumen operativo y superficies de sincronizacion activas.",
        },
        experiences: {
          label: "Experiencias",
          description: "Indice de experiencias y estado de publicacion.",
        },
        videos: {
          label: "Videos",
          description: "Biblioteca de videos, fuentes y cobertura de doblajes.",
        },
        media: {
          label: "Media",
          description: "Inventario de activos compartidos y colas de revision.",
        },
        languages: {
          label: "Idiomas",
          description: "Datos de referencia y cobertura de locales.",
        },
        systemStatus: {
          label: "Sincronizacion Core",
          description:
            "Salud de sincronizacion, retraso y estado del pipeline.",
        },
        workflows: {
          label: "Flujos",
          description: "Ejecuciones duraderas, reintentos y estado de cola.",
        },
        embeddings: {
          label: "Embeddings",
          description: "Cobertura vectorial, vigencia y estado de indices.",
        },
        search: {
          label: "Busqueda semantica",
          description: "Calidad de recuperacion e inspeccion de trazas.",
        },
        users: {
          label: "Usuarios",
          description: "Permisos, invitaciones y postura de roles.",
        },
        userPlaylistModeration: {
          label: "Moderacion de playlists",
          description: "Reportes redactados y acciones sobre playlists.",
        },
        partnerKeys: {
          label: "Claves API de socios",
          description: "Tokens portadores emitidos y estado de revocacion.",
        },
        mcp: {
          label: "MCP",
          description:
            "Endpoints MCP de Admin, alcances OAuth y skills de agentes.",
        },
        settings: {
          label: "Configuracion",
          description: "Claves, proveedores y controles de entorno.",
        },
      },
    },
    home: {
      title: "Forge Admin",
      description:
        "La base ya esta lista. Consulta docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.",
      links: {
        login: "/api/auth/login",
        dashboard: "/dashboard",
        systemStatus: "/dashboard/system-status",
        health: "/api/health",
      },
    },
    login: {
      brandName: "JesusFilm",
      hero: "Inicia sesion con tu cuenta JesusFilm.",
      labels: {
        welcomeBack: "Inicia sesion para continuar",
        emailAddress: "Correo electronico",
        password: "Contrasena",
        divider: "O",
      },
      destination: {
        context: "Continuando a {destination}",
        helper: "Estas iniciando sesion para acceder a {destination}.",
        defaultName: "panel de administracion Forge",
      },
      placeholders: {
        email: "admin@example.com",
        password: "••••••••••••",
      },
      actions: {
        checkAccessStatus: "Comprobar estado de acceso",
        continue: "Continuar",
        signingIn: "Ingresando…",
        continueWith: "Continuar con {provider}",
        continueToAdmin: "Continuar al admin",
        requestAccess: "Solicitar acceso",
        requestingAccess: "Solicitando acceso…",
        signInAgain: "Iniciar sesion de nuevo",
        tryDifferentAccount: "Probar otra cuenta",
      },
      providers: {
        facebook: "Facebook",
        google: "Google",
        apple: "Apple",
        okta: "Okta",
      },
      errors: {
        forbidden:
          "Iniciaste sesion, pero el acceso de administrador aun no fue aprobado.",
        invalidCredentials: "Correo o contrasena no validos",
        requestAccessFailed:
          "No se pudo solicitar acceso. Intenta iniciar sesion de nuevo.",
      },
      access: {
        accountLabel: "Iniciaste sesion como",
        approved:
          "El acceso fue aprobado. Continua para iniciar sesion de nuevo y entrar al panel.",
        available:
          "Iniciaste sesion, pero el acceso de administrador aun no fue aprobado. Solicita acceso y un administrador revisara tu cuenta.",
        description:
          "Esta cuenta esta autenticada, pero aun no tiene aprobacion para Forge Admin.",
        pending:
          "Iniciaste sesion, pero el acceso de administrador aun no fue aprobado. Un administrador aun debe aprobar tu cuenta.",
        requested:
          "Acceso solicitado. Un administrador debe aprobar tu cuenta antes de que puedas entrar al panel.",
        title: "Se requiere acceso de administrador",
        unavailable:
          "No se encontro una solicitud de acceso activa. Inicia sesion de nuevo para comprobar tu acceso.",
      },
    },
    pages: {} as Record<string, never>,
  },
} as const
;(
  adminMessages as unknown as { es: { pages: typeof adminMessages.en.pages } }
).es.pages = JSON.parse(JSON.stringify(adminMessages.en.pages))

export type AdminMessages = typeof adminMessages.en
