// Curriculum adapted from the read-only prototype transcription of the ministry guide.
// Guide wording: Beginning With Jesus v2 © 2023 Jesus Film Project, pages 7, 10–18.
// Solo prompts and benefit copy are original Watch adaptations, not guide quotations.
// Film inventory, playback identifiers, runtimes and simulated social data are excluded.
import { asContentSlug, asLocaleSlug, watchEpisodePath } from "./routes"

export const COURSE_ID = "beginning-with-jesus" as const
export const CONTENT_VERSION = "2026-10-17-v1" as const
export type LessonId = `lesson-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`

export type MovementId = "back" | "up" | "forward"

export type Prompt = {
  /** The guide's wording, for a group. */
  group: string
  /** Ours, for one person on their own. */
  solo: string
}

/**
 * How a prompt is answered. The guide prints these as bullet points; on screen
 * a bullet you tick is a form, so each one gets the interaction it actually
 * asks for — a word for your week, a name you carry, a minute you sit through.
 */
export type PromptUi =
  | { kind: "choice"; options: string[]; then?: string }
  | { kind: "people"; placeholder: string }
  | { kind: "write"; placeholder: string; rows?: number }
  | { kind: "commit"; placeholder: string }
  | { kind: "still"; seconds: number; verb: string }
  | { kind: "recall" }

export type StepPrompt = Prompt & {
  /** Stable key for the answer. Never renumber these. */
  id: string
  ui: PromptUi
}

export type PromptGroup = {
  title: string
  items: StepPrompt[]
}

export type Lesson = {
  id: LessonId
  sourcePage: number
  n: number
  /** Guide: "Lesson 1 - How You Can Be Sure You Are a Christian". */
  title: string
  /** Guide: the JESUS segment title, in quotes on the page. */
  segment: string
  /** Chapter slug on jesusfilm.org. */
  slug: string
  /** Guide: the Scripture line under the segment title. */
  scripture: string
  /** Guide: the Introduction paragraph. */
  intro: string
  /** Guide: Step 4's discussion questions, in order. */
  questions: string[]
  /** Guide: the Conclusion, opening paragraph. */
  conclusion: string
  /** Guide: the numbered list inside the Conclusion, where it has one. */
  points?: string[]
  pointsTitle?: string
  /** Where the points are not the guide's own list, say whose they are. */
  pointsNote?: string
  /** Guide: the Conclusion's closing paragraph, after the list. */
  conclusionEnd?: string
  /** Guide: the Leader's Note, lesson 9 only. */
  leaderNote?: string
  /** OURS, not the guide's: the reason to start this one, shown before the
      lesson opens. The guide assumes a leader in the room who supplies the
      "why" out loud; on a page nobody does, so we say it up front. */
  why: {
    /** The recognition line — "Start here if …". */
    ifYou: string
    /** The benefit, in one line. */
    promise: string
    /** What you actually walk away holding. */
    payoff: string
  }
}

export const BWJ = {
  courseId: COURSE_ID,
  contentVersion: CONTENT_VERSION,
  materials: "https://www.jesusfilm.org/beginning-with-jesus/materials/",
  title: "Beginning With Jesus",
  /** Guide, cover. */
  tagline: "A nine-part strategy to form fruitful and joyful believers.",
  /** Guide, cover. */
  blurb:
    "Using the JESUS film to help people better understand what it means to follow Him.",
  copyright: "Beginning With Jesus v2 © 2023 Jesus Film Project",
  pdf: "https://www.jesusfilm.org/wp-content/uploads/2026/03/Beginning-With-Jesus.pdf",
  about: "https://www.jesusfilm.org/beginning-with-jesus/",
  knowingJesus:
    "https://www.jesusfilm.org/partners/resources/strategies/knowing-jesus/",
  knowingJesusVideo: "https://www.youtube.com/watch?v=MkYpNK5OvKk",
  app: "https://www.jesusfilm.org/tools/app/",
} as const

/** Route helper owns canonical English chapter links; no harvested catalog data. */
export function chapterHref(slug: string) {
  return watchEpisodePath(
    asContentSlug("jesus"),
    asContentSlug(slug),
    asLocaleSlug("english"),
  )
}

/* ---------------------------------------------------------------------------
   The 3/3 format — guide, page 7 ("Three – Thirds, A Discipleship Training
   Process"). These five/three/four bullets are the author's own.
--------------------------------------------------------------------------- */

export const MOVEMENTS: {
  id: MovementId
  name: string
  /** What this third is for, in the guide's own bullets. */
  bullets: string[]
  /** Ours — one line for the person reading this alone. */
  soloLine: string
}[] = [
  {
    id: "back",
    name: "Looking Back",
    bullets: [
      "Caring for each other, ask “How are you doing?”",
      "Worship and sing.",
      "Share life stories and backgrounds.",
      "Motivate and encourage.",
      "Reflect.",
    ],
    soloLine: "Land first. Notice where the week actually left you.",
  },
  {
    id: "up",
    name: "Looking Up",
    bullets: [
      "Learn a new story together about Jesus.",
      "Acknowledge all Scripture is God-breathed, authoritative and true.",
      "Discuss as many questions as time allows.",
    ],
    soloLine: "Watch it twice, tell it back, then stay with the questions.",
  },
  {
    id: "forward",
    name: "Looking Forward",
    bullets: [
      "Determine how you will apply what you’ve learned.",
      "Pray together.",
      "Practice sharing the story among the group.",
      "Share concerns and needs for the coming week.",
    ],
    soloLine: "Choose one thing and one person. Then pray it.",
  },
]

/** Guide: the Looking Back block that repeats at the top of every lesson page. */
export const LOOKING_BACK: PromptGroup[] = [
  {
    title: "Care for one another",
    items: [
      {
        id: "how",
        group: "Share time and conversation together.",
        solo: "How are you, actually?",
        ui: {
          kind: "choice",
          options: [
            "Heavy",
            "Tired",
            "Steady",
            "Restless",
            "Grateful",
            "Hopeful",
          ],
          then: "Say a bit more, if you want to.",
        },
      },
      {
        id: "carrying",
        group: "Pray for one another.",
        solo: "Who are you carrying this week?",
        ui: { kind: "people", placeholder: "A name" },
      },
    ],
  },
  {
    title: "Give",
    items: [
      {
        id: "give",
        group: "Practice generosity.",
        solo: "One generous thing, today.",
        ui: {
          kind: "choice",
          options: [
            "Pay for someone",
            "Give time",
            "Give something away",
            "Say the kind thing",
          ],
          then: "What will it be?",
        },
      },
    ],
  },
  {
    title: "Desire for yourselves and the group",
    items: [
      {
        id: "want",
        group: "Encourage each other to be committed followers of Christ.",
        solo: "What do you want from God this week?",
        ui: { kind: "write", placeholder: "Ask for it plainly." },
      },
      {
        id: "quiet",
        group: "Worship together in song or prayer.",
        solo: "Two minutes of quiet before you watch anything.",
        ui: { kind: "still", seconds: 120, verb: "Two minutes of quiet" },
      },
    ],
  },
  {
    title: "Celebrate your community",
    items: [
      {
        id: "went-right",
        group: "Encourage one another in victories.",
        solo: "One thing that went right since last time.",
        ui: { kind: "write", placeholder: "However small it was." },
      },
    ],
  },
]

/** Guide: Step 1–4, printed above the questions on every lesson page. */
export const LESSON_STEPS: Prompt[] = [
  {
    group: "Watch the segment twice.",
    solo: "Watch the segment twice.",
  },
  {
    group:
      "Ask a member of the group to tell the story of the segment in his or her own words.",
    solo: "Tell the story back in your own words, out loud.",
  },
  {
    group:
      "Allow the group to fill in any gaps in the story or make any corrections.",
    solo: "Watch again and catch what you left out.",
  },
  {
    group: "Group discussion. It is not necessary to complete all questions.",
    solo: "Sit with the questions. You do not have to answer all of them.",
  },
]

/** Guide: the Looking Forward block that repeats at the foot of every lesson page. */
export const LOOKING_FORWARD: PromptGroup[] = [
  {
    title: "Application",
    items: [
      {
        id: "trustworthy",
        group: "How did God demonstrate Himself as trustworthy?",
        solo: "Where did God show Himself trustworthy — in the story, or in your week?",
        ui: {
          kind: "write",
          placeholder: "In the story, or in your week.",
          rows: 3,
        },
      },
      {
        id: "differently",
        group: "How will you apply what you’ve learned about God?",
        solo: "One thing you will do differently this week.",
        ui: { kind: "commit", placeholder: "I will…" },
      },
      {
        id: "retell",
        group: "Practice telling the story to one another.",
        solo: "Tell the story once more, from memory.",
        ui: { kind: "still", seconds: 60, verb: "Tell it from memory" },
      },
    ],
  },
  {
    title: "Prayer",
    items: [
      {
        id: "thanks",
        group: "Thank God for what you have learned.",
        solo: "Thank Him for one thing you saw today.",
        ui: {
          kind: "still",
          seconds: 30,
          verb: "Stay here for thirty seconds",
        },
      },
      {
        id: "lands",
        group: "Pray about how the theme of the story relates to your life.",
        solo: "Pray this story into your own week.",
        ui: { kind: "still", seconds: 60, verb: "Pray for a minute" },
      },
      {
        id: "for-them",
        group: "Pray for each other’s needs.",
        solo: "Pray for the people you named at the start.",
        ui: { kind: "recall" },
      },
    ],
  },
]

/* ---------------------------------------------------------------------------
   Guide, pages 4–8: the four steps a leader takes before and after the nine
   lessons. Condensed; the wording is the author's.
--------------------------------------------------------------------------- */

export const LEADER_STEPS: { n: string; title: string; body: string[] }[] = [
  {
    n: "01",
    title: "Prepare",
    body: [
      "Before we can help others grow in their spiritual lives, we must first understand the foundational truths found in Beginning With Jesus. Practice with your own family or a small group of close friends.",
      "Next, identify a “Timothy” — someone who will come with you to help other new believers understand the key concepts, and who may begin their own group when yours ends.",
      "Lastly, identify a “person of peace”: someone open to Christ, influential or well-known, willing to introduce you to their family and friends. Build that friendship by prayer, then care, then sharing.",
    ],
  },
  {
    n: "02",
    title: "Show",
    body: [
      "With your person of peace, invite some people to watch the JESUS film. Share a meal together and watch the film afterward. Care well for each person who attends, and practice generous hospitality.",
      "At the closing of the film, offer two invitations: first, to become followers of Jesus; second, to come back the next day to talk more about Jesus.",
    ],
  },
  {
    n: "03",
    title: "Start",
    body: [
      "Pray over each person that showed interest. Ask God to soften their hearts and draw them by the Holy Spirit.",
      "Beginning With Jesus uses the foundational truths of Cru’s Transferable Concepts paired with nine segments of the JESUS film, and the “three-thirds” format for every meeting.",
      "This curriculum is a template. Please feel free to adapt it to best accommodate your cultural needs.",
    ],
  },
  {
    n: "04",
    title: "Continue",
    body: [
      "The last lesson is about continuing to follow Jesus. Prayerfully guide the individuals in your group towards the most appropriate next step.",
      "If they are ready, challenge one or more of them to begin their own Beginning With Jesus group. If your group would like to keep meeting, move on to a new study such as Knowing Jesus.",
    ],
  },
]

/* ---------------------------------------------------------------------------
   The nine lessons — guide, pages 10–18, verbatim.
--------------------------------------------------------------------------- */

export const LESSONS: Lesson[] = [
  {
    id: "lesson-1",
    sourcePage: 10,
    n: 1,
    why: {
      ifYou:
        "you have prayed a prayer like this before and still are not sure it took",
      promise: "Leave sure — on a day you don’t feel it.",
      payoff:
        "Feelings move every week. By the end of this one you will know what your standing with God actually rests on, and you will have said it back in your own words.",
    },
    title: "How You Can Be Sure You Are a Christian",
    segment: "Invitation to Know Jesus Personally",
    slug: "invitation-to-know-jesus-personally",
    scripture: "1 Corinthians 15:1-4",
    intro:
      "Millions of people have invited Christ into their lives but they are not sure of their salvation. They have no confidence that if they died today, they would go to be with the Lord in heaven. Are you confident? A commitment to Christ involves intellect, emotions and will.",
    questions: [
      "What did you like the most about the story? What caught your attention?",
      "What does the word “sin” mean to you? How did Jesus pay the price for your sin?",
      "Christians are called to live by faith, not emotions. What place does emotion have in your Christian life? How and when can emotions be misleading?",
      "Why is it important that you be sure of your salvation?",
    ],
    conclusion:
      "There are four essential truths you need to understand to be sure you are a Christian:",
    pointsTitle: "Four essential truths",
    points: [
      "God loves you and offers a wonderful plan for your life.",
      "We are all sinful and separated from God; therefore, we cannot experience His love and plan for our lives apart from Jesus Christ.",
      "Jesus Christ is God’s only provision for man’s sin. Through Him alone we can know God personally and experience His love.",
      "We must individually receive Jesus Christ as Savior and Lord; then we can know God personally and experience His love.",
    ],
    conclusionEnd:
      "Watch the segment one last time, this time praying with certainty to receive Jesus. If you have received Jesus Christ as Savior and Lord, you can be sure you are a Christian based on the promises of His Word.",
  },
  {
    id: "lesson-2",
    sourcePage: 11,
    n: 2,
    why: {
      ifYou: "there is something you would not say out loud",
      promise: "Put down the thing you keep carrying.",
      payoff:
        "You will name one thing honestly — to God, not to a room — and find out it was dealt with before you got here.",
    },
    title: "How to Experience God’s Love and Forgiveness",
    segment: "Sinful Woman Forgiven",
    slug: "sinful-woman-forgiven",
    scripture: "Luke 7:36-50",
    intro:
      "Jesus loved and spent time with tax collectors, prostitutes, outcasts and the sick. In those days, sick people were sometimes assumed to be sinful because of their illness. Jesus never condemned these people; in fact, the only people He ever condemned were religious leaders who considered themselves better than others. The Bible tells us that Jesus Christ, through His death on the cross, has set us free — free from sin, free from having to earn God’s approval by our own works, and free from the bondage of guilt.",
    questions: [
      "What did you like most about the story? What caught your attention?",
      "Why do you think the young woman was crying?",
      "What was the reaction of the Pharisee to what the woman did? How did Jesus react?",
      "What do you think was the point of the story about forgiveness that Jesus told the Pharisee?",
      "How did the woman show that she believed in Jesus?",
      "Why do you think Simon did not offer any hospitality to Jesus?",
      "When Jesus says to the woman “Your faith has saved you,” what do you think she was saved from?",
    ],
    conclusion:
      "To experience the same forgiveness as the young woman in this story, you must confess your sins by faith. The Bible promises that if you confess your sins to Him, He is faithful and just to forgive and purify you from all unrighteousness (1 John 1:9). The word “confess” doesn’t mean to tell God something He doesn’t know. Rather, the word means “to agree with God.”",
    pointsTitle: "Three ways we agree with God",
    points: [
      "We agree that our sins are wrong and grieve God.",
      "We agree that God has already forgiven our sins through Christ’s death and the shedding of His blood on the cross.",
      "We agree that we need to yield that area of sin to the Lord and repent.",
    ],
    conclusionEnd:
      "We allow the Holy Spirit to change our attitude. Through the strength of the Holy Spirit, we turn from our sins, and our behavior begins to change.",
  },
  {
    id: "lesson-3",
    sourcePage: 12,
    n: 3,
    why: {
      ifYou: "trying harder keeps not working",
      promise: "Stop running your faith on willpower.",
      payoff:
        "You will find out why effort alone keeps failing, and what to ask for instead. You can reflect on what depending on God might look like this week.",
    },
    title: "How You Can Be Filled With the Holy Spirit",
    segment: "Teaching About Prayer and Faith",
    slug: "teaching-about-prayer-and-faith",
    scripture: "Luke 11:9-13, 12:22-30, 17:5-6",
    intro:
      "When Jesus taught about prayer He used three pairs of words: ask and given, seek and find, knock and opened. His description emphasizes the Father’s desire to give us the fullness of the Holy Spirit, if we ask. As the disciples were filled with the Holy Spirit, they received a supernatural power from God that changed them from fearful people to bold witnesses for Christ. This same power is available to you.",
    questions: [
      "What did you like most about the story? What caught your attention?",
      "What conditions does Jesus put on how He will answer prayer? Why might there be some prayers God might not answer? Give an example.",
      "What do you think Jesus means when He says, “If you then being evil”? Why is it that people can be both good and evil?",
      "Read Ephesians 5:18 in your Bible. What command does God give us in this passage?",
      "Why do you think it would be important for us to have the power of the Holy Spirit in us?",
      "How might the Holy Spirit’s power be seen in the life of a Christian?",
    ],
    conclusion:
      "The Holy Spirit is God Himself. He came to live inside you the moment you received Christ as your Savior. The Holy Spirit came to glorify Christ and to lead believers into all truth. To be filled with the Holy Spirit is to be filled with the fullness of God. We are filled with the Holy Spirit by faith.",
    pointsTitle: "How we are filled, by faith",
    points: [
      "Each of us must desire to live a life that will please the Lord.",
      "We must be willing to surrender our lives totally to Him.",
      "We must confess every known sin which God brings to our remembrance.",
    ],
    conclusionEnd:
      "Then by faith, we must trust God to fill us with His Holy Spirit, and to give us the power to live the life He has in store for us.",
  },
  {
    id: "lesson-4",
    sourcePage: 13,
    n: 4,
    why: {
      ifYou: "the thought of bringing Jesus up makes you tense",
      promise: "Talk about Jesus without dreading it.",
      payoff:
        "You will write what you would actually say, in your own words, for one person by name. No script, no pressure, no audience.",
    },
    title: "How You Can Be a Fruitful Witness",
    segment: "Miraculous Catch of Fish",
    slug: "miraculous-catch-of-fish",
    scripture: "Luke 5:1-11",
    intro:
      "Jesus performed this miracle to show His disciples that He was the Messiah, and that they should follow Him and become “fishers of men.” They recognized that Jesus was the Messiah, and they left their fishing nets and followed Him. There is no experience in life more exciting than helping others come to follow Christ.",
    questions: [
      "What did you like most about the story? What caught your attention?",
      "What did Jesus ask Peter to do? Was it a suggestion or a command?",
      "What was Peter’s reaction to Jesus’ words?",
      "Why do you think Peter said that he was a “sinful man”? Why would he ask Jesus to go away?",
      "How did Peter, James, and John show their commitment to Jesus?",
      "What do you think Jesus meant when He said they would become “fishers of men”?",
      "What are some things that may keep you from talking to others about Jesus? What might encourage you to talk to others about Jesus?",
    ],
    conclusion:
      "In our earlier lessons we learned that to be a fruitful witness, you should be confident in your salvation, have confessed the sin in your life and be filled with the Holy Spirit. Last, you must be prepared to share your faith by learning the story of the gospel. You can tell the gospel in your own words or show the last segment from the JESUS film to a friend or neighbor who needs to know Jesus. Most importantly, you need to love people and take the initiative to go and tell the good news. Pray for opportunities and expect God to use you.",
  },
  {
    id: "lesson-5",
    sourcePage: 14,
    n: 5,
    why: {
      ifYou: "you wonder whether your ordinary week counts for anything",
      promise: "Find your part in something bigger than your week.",
      payoff:
        "You will see where your own life already touches this, and choose the one place you will put yourself next.",
    },
    title: "How You Can Help Fulfill the Great Commission",
    segment: "Great Commission and Ascension",
    slug: "great-commission-and-ascension",
    scripture: "Luke 24:50-53",
    intro:
      "Jesus’ command to His followers to tell others the message of salvation is called the Great Commission. Every Christian is commanded to be involved in reaching the world for Christ. That means each of us has a God-given role to play in helping to fulfill His Great Commission. If you can, read Matthew 28:16-20 in your heart language first.",
    questions: [
      "What did you like most about the story? What caught your attention?",
      "What are the specific commands that Jesus gives His disciples in the Great Commission?",
      "Is this commission meant for the disciples only, or is it a calling for all believers? Why or why not?",
      "Why do you think Jesus tells us as His followers that He has “all authority in heaven and Earth”? How might that be significant to us as we seek to share Christ with others?",
      "Read Acts 1:8-9. Why do you think Jesus told His disciples to start first in Jerusalem? Why was that significant? What does Jesus say they are to do next?",
      "Based on the passage we just read from Acts 1, to whom were the disciples commanded to take the gospel? What might this tell us about how Jesus views all people?",
      "Can you think of a people group in your country that needs to hear the gospel? How could you be the one to GO and TELL them about Jesus?",
    ],
    conclusion: "How can you help fulfill the Great Commission?",
    pointsTitle: "Five steps",
    points: [
      "Be sure you are personally committed to Christ and filled with the Holy Spirit.",
      "Pray for God to guide you.",
      "As God answers your prayers, plan where you will GO.",
      "Seek training from other mature Christians.",
      "Take the initiative and GO. Find a Christian friend to go with you to share the gospel with others who desperately need Him.",
    ],
  },
  {
    id: "lesson-6",
    sourcePage: 15,
    n: 6,
    why: {
      ifYou: "there is a person you cannot make yourself love",
      promise: "Love the person you don’t like.",
      payoff:
        "You will learn what to do when the feeling is not there and the person is still in front of you — and pick one person to try it on this week.",
    },
    title: "How You Can Love By Faith",
    segment: "Parable of the Good Samaritan",
    slug: "parable-of-the-good-samaritan",
    scripture: "Luke 10:25-37",
    intro:
      "Love is the greatest privilege and power known to man. In this story, a lawyer spoke the truth when he said we should love God and our neighbor. But then he asked Jesus, “Who is my neighbor?” Jesus answered by telling a story in which a Samaritan — a people group hated by the Jews — is the only person who helps a man in desperate need. Only by God’s power and strength can we truly love our neighbors unconditionally, just as God loves us.",
    questions: [
      "What did you like most about the story? What caught your attention?",
      "What question is asked of Jesus at the beginning of this story?",
      "How does Jesus answer the man? What does this tell us about the significance of the Bible?",
      "What do you think is revealed about the lawyer’s heart by the second question he asks Jesus?",
      "Who were the people that did not help the man who had been robbed? Why do you think they failed to help the wounded man?",
      "How did the Samaritan show that “he loved his neighbor”? What did this love cost the Samaritan?",
      "How could you show love to someone in your community this week?",
    ],
    conclusion: "Five points to remember about love:",
    pointsTitle: "Five points about love",
    points: [
      "God loves us unconditionally.",
      "We are commanded to love others.",
      "We cannot love in our own strength.",
      "We can love with God’s love.",
      "We love by faith, just as we received Jesus by faith.",
    ],
  },
  {
    id: "lesson-7",
    sourcePage: 16,
    n: 7,
    why: {
      ifYou: "prayer feels like talking to the ceiling",
      promise: "Pray tonight without hunting for words.",
      payoff:
        "Jesus was asked this exact question, and answered it with a shape rather than a speech. You will use that shape before you close this page.",
    },
    title: "How You Can Pray With Confidence",
    segment: "The Lord’s Prayer",
    slug: "the-lord-prayer",
    scripture: "Luke 11:1-4",
    intro:
      "Prayer is a dialogue between two persons who love each other — God and man. Simply put, prayer is communicating with God. Prayer is much more than words, however. It is an expression of the heart towards God. It is an experience within a relationship more than an activity. As a child of God, you are invited to come boldly before Him in prayer.",
    questions: [
      "What did you like most about the story? What caught your attention?",
      "Why do you think one of the disciples would ask Jesus to teach them to pray after He had finished praying?",
      "To whom does Jesus say that we should direct our prayers? Why is this important?",
      "When Jesus says, “Your Kingdom come,” what is He indicating about the future?",
      "What does it mean when Jesus asks God to supply “our daily bread”? What do you think is the significance of the word “daily”?",
      "Why do you think Jesus connects our asking God for forgiveness with our willingness to forgive others who sin against us?",
      "Why do you think it is sometimes hard to forgive those who have hurt or wronged us?",
      "How might God help us in times of temptation?",
    ],
    conclusion:
      "God commands us to pray continually (1 Thessalonians 5:17). At the same time, prayer is a privilege. We pray to have fellowship with God, to express our needs and desires, to bring our concerns and fears to Him, to ask God to help those we care about, to ask God to help others understand the gospel and come to Christ, to confess our sins, to express our thanks and to praise and adore Him. We pray to the Father in the name of the Lord Jesus Christ through the ministry of the Holy Spirit. As we abide in Him, we can pray with confidence.",
  },
  {
    id: "lesson-8",
    sourcePage: 17,
    n: 8,
    why: {
      ifYou: "money has more of you than you would like",
      promise: "Loosen money’s grip — starting small.",
      payoff:
        "You will decide one real, specific thing to give, and find out what giving does to the giver.",
    },
    title: "How You Can Experience the Adventure of Giving",
    segment: "Widow’s Offering",
    slug: "widow-offering",
    scripture: "Luke 21:1-4",
    intro:
      "God loves widows and orphans. In Jesus’ day, widows were usually the poorest group in the community. In this story, we find a widow giving everything she had as an offering to God. She demonstrated a concept called “stewardship” — a belief that everything we possess belongs to God and we are simply “managers” of God’s possessions. Giving by faith is meant by God to be an exciting privilege.",
    questions: [
      "What did you like most about the story? What caught your attention?",
      "Do you think it is easier for rich people to give money than for poor people?",
      "Why would the widow give everything she had to live on? What does this tell us about her personal faith in God?",
      "Share a way in which you might be tempted to give less. How might you overcome this?",
      "How could you share your abundance with others, in both material and non-material ways?",
      "Do you think Jesus expects even poor people to give to the church?",
    ],
    conclusion:
      "All that we have, we possess because God has provided it for us. So everything we have belongs to Him. Our task as “faithful stewards” is to manage those blessings to bring glory to His name. When we give freely of ourselves, and of our possessions, we are making a material expression of our spiritual dependence upon Christ. The apostle Paul wrote to the Christians at Philippi: “And my God will meet all your needs according to the riches of his glory in Christ Jesus” (Philippians 4:19, NIV).",
  },
  {
    id: "lesson-9",
    sourcePage: 18,
    n: 9,
    why: {
      ifYou: "you have started something like this before and drifted",
      promise: "Make this outlast the nine.",
      payoff:
        "You will reflect on what helps faith take root, and choose a next step for the week after this one.",
    },
    title: "How You Can Continue to Grow",
    segment: "Parable of the Sower and the Seed",
    slug: "parable-of-the-sower-and-the-seed",
    scripture: "Luke 8:4-15",
    intro:
      "Jesus taught the people through sermons, through questions and answers, and in “parables.” Parables were a common way of teaching others through telling stories. A parable is “an earthly story with a heavenly meaning.”",
    questions: [
      "What did you like most about the story? What caught your attention?",
      "What are the four soils that Jesus talks about in this parable? What does each soil represent?",
      "What do you think that Jesus means when He says, “Let him who has ears to hear, let him hear”?",
      "What kind of temptation might cause people to give up their faith in God?",
      "Jesus says the good soil will yield a harvest of fruit. What spiritual fruit is Jesus talking about?",
      "What can we do to prepare our soil so God can produce fruit in our lives?",
    ],
    conclusion:
      "In this story, Jesus explains how the Word of God brings about spiritual growth. The good soil represents those who produce fruit in their lives and the lives of others. In order to become that “good soil” we need to continue following Jesus by learning more about Jesus and obeying God in our daily lives. It also involves serving Christ by helping others to hear the gospel and learn to follow Jesus. Do you desire to be good soil?",
    pointsTitle: "The four soils",
    pointsNote:
      "Watch adaptation: paraphrases of Jesus’ explanation in Luke 8:11-15; not a numbered list from the guide",
    points: [
      "The path — those who hear, then the devil takes away the word from their hearts.",
      "The rock — those who receive the word with joy, but have no root; in a time of testing they fall away.",
      "The thorns — those who hear, and are choked by the cares, riches and pleasures of life.",
      "The good soil — those who hear the word, hold it fast in an honest and good heart, and bear fruit with patience.",
    ],
    conclusionEnd:
      "Although this concludes the Beginning With Jesus material, Jesus Film Project offers other opportunities to help you continue to learn and grow spiritually. You may also wish to share what you have learned with others and begin your own Beginning With Jesus group.",
    leaderNote:
      "It’s important to invite everyone to continue to follow Jesus, in general, and specifically by continuing the discipleship program. Be sure to ask the group, “Does anyone wish to learn more about following Jesus? Would any of you like to continue learning together?”",
  },
]

export type LessonCard = {
  id: string
  movementId: MovementId | null
  title: string
  body: string
  /** Guide prompt where a solo adaptation is used. */
  guide?: string
  completable: boolean
  reflection: boolean
  source: "guide" | "watch-adaptation"
}

/** Semantic deck shared by the sheet and future story. Navigation never completes a card. */
export function lessonCards(lesson: Lesson): LessonCard[] {
  const prompts = (
    groups: PromptGroup[],
    movementId: MovementId,
  ): LessonCard[] =>
    groups.flatMap((group) =>
      group.items.map((prompt) => ({
        id: `${movementId}-${prompt.id}`,
        movementId,
        title: group.title,
        body: prompt.solo,
        guide: prompt.group,
        completable: true,
        reflection: true,
        source: "watch-adaptation" as const,
      })),
    )
  const up = (
    id: string,
    title: string,
    body: string,
    reflection = false,
  ): LessonCard => ({
    id,
    movementId: "up",
    title,
    body,
    completable: id !== "up-intro",
    reflection,
    source: "guide",
  })
  return [
    {
      id: "cover",
      movementId: null,
      title: lesson.why.promise,
      body: lesson.why.payoff,
      completable: false,
      reflection: false,
      source: "watch-adaptation",
    },
    ...prompts(LOOKING_BACK, "back"),
    up("up-intro", "Introduction", lesson.intro),
    up("up-watch", lesson.segment, LESSON_STEPS[0]!.group),
    {
      ...up(
        "up-retell",
        "Tell the story",
        LESSON_STEPS[1]!.solo + " " + LESSON_STEPS[2]!.solo,
        true,
      ),
      guide: LESSON_STEPS[1]!.group + " " + LESSON_STEPS[2]!.group,
      source: "watch-adaptation",
    },
    ...lesson.questions.map((question, index) =>
      up(`up-question-${index + 1}`, `Question ${index + 1}`, question, true),
    ),
    up("up-conclusion", "Conclusion", lesson.conclusion),
    ...(lesson.points ?? []).map((point, index) => ({
      ...up(
        `up-truth-${index + 1}`,
        `${lesson.pointsTitle ?? "Truth"} · ${index + 1}`,
        point,
      ),
      source: lesson.pointsNote
        ? ("watch-adaptation" as const)
        : ("guide" as const),
    })),
    ...prompts(LOOKING_FORWARD, "forward"),
    {
      id: "end",
      movementId: null,
      title: "Take this into your week",
      body:
        [lesson.conclusionEnd, lesson.leaderNote]
          .filter(Boolean)
          .join("\n\n") || "Choose one step to put into practice.",
      completable: false,
      reflection: false,
      source: lesson.conclusionEnd ? "guide" : "watch-adaptation",
    },
  ]
}
