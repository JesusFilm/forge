/** Public resource metadata only. The nine-lesson curriculum lives in a deferred module. */
export const WATCH_GROW_COURSE = {
  title: "Beginning With Jesus",
  summary:
    "Nine lessons to help you understand what it means to follow Jesus. Watch a story, reflect, and choose one step for your week.",
  about: "https://www.jesusfilm.org/beginning-with-jesus/",
  materials: "https://www.jesusfilm.org/beginning-with-jesus/materials/",
  image:
    "https://www.jesusfilm.org/wp-content/uploads/2023/07/KJ_Header2-1.jpg?w=700",
} as const

export type GrowPlan = {
  id: string
  title: string
  /** Who it was written for — our grouping, not YouVersion's. */
  lane: string
  /** Day count only where the publisher states one. */
  days?: number
  url: string
}

/** Real YouVersion destinations from the prototype; each page checked 2026-10-17.
 * Plans have different credited authors; lane labels are our grouping. */
export const GROW_PLANS: GrowPlan[] = [
  {
    id: "40801",
    title: "How to Reach Your Co-Workers",
    lane: "At work",
    url: "https://www.bible.com/reading-plans/40801-how-to-reach-your-co-workers",
  },
  {
    id: "28927",
    title: "Hope for School Teachers",
    lane: "Teachers",
    url: "https://www.bible.com/reading-plans/28927-hope-for-school-teachers",
  },
  {
    id: "76161",
    title: "The Anxiety Free School Year",
    lane: "Teachers",
    url: "https://www.bible.com/reading-plans/76161-the-anxiety-free-school-year",
  },
  {
    id: "30002",
    title: "Hope for Police Officers",
    lane: "First responders",
    days: 7,
    url: "https://www.bible.com/reading-plans/30002-hope-for-police-officers",
  },
  {
    id: "32529",
    title: "Hope For First Responders",
    lane: "First responders",
    url: "https://www.bible.com/reading-plans/32529-hope-for-first-responders",
  },
  {
    id: "26593",
    title: "Hope for Single Fathers",
    lane: "Parents",
    url: "https://www.bible.com/reading-plans/26593-hope-for-single-fathers",
  },
  {
    id: "25718",
    title: "Heart of a Champion: An Athlete’s Identity in God",
    lane: "Athletes",
    url: "https://www.bible.com/reading-plans/25718-heart-of-a-champion-an-athletes-identity-in-god",
  },
  {
    id: "57138",
    title: "Come as You Are: A Journey With Jesus for Women",
    lane: "Women",
    url: "https://www.bible.com/reading-plans/57138-an-easter-devotional-for-women-come-as-you-are",
  },
  {
    id: "19655",
    title: "The Women Who Met Jesus",
    lane: "Women",
    url: "https://www.bible.com/reading-plans/19655-the-women-who-met-jesus",
  },
  {
    id: "61252",
    title: "Win–Build–Send",
    lane: "On mission",
    url: "https://www.bible.com/reading-plans/61252-winbuildsend-stories-to-encourage-you-to-",
  },
  {
    id: "70460",
    title: "Courageous Obedience: Lessons From the Way of St. Patrick",
    lane: "On mission",
    url: "https://www.bible.com/reading-plans/70460-courageous-obedience-lessons-from-the-way-of",
  },
  {
    id: "61011",
    title: "Impulses for the Way: 30 Days on the Camino de Santiago",
    lane: "Walking a long road",
    days: 30,
    url: "https://www.bible.com/reading-plans/61011-impulses-for-the-way-30-days-on-the-camino-de-sa",
  },
  {
    id: "60248",
    title: "The Way of St James (Camino de Santiago)",
    lane: "Walking a long road",
    url: "https://www.bible.com/reading-plans/60248-the-way-of-st-james-camino-de-santiago",
  },
  {
    id: "35312",
    title: "Finding Hope on the Camino",
    lane: "Walking a long road",
    url: "https://www.bible.com/reading-plans/35312-finding-hope-on-the-camino",
  },
  {
    id: "73791",
    title: "What’s the Real Meaning of Christmas?",
    lane: "This season",
    url: "https://www.bible.com/reading-plans/73791-whats-the-real-meaning-of-christmas",
  },
]

export const GROW_PLAN_LANES = Array.from(
  new Set(GROW_PLANS.map((p) => p.lane)),
)

export type WatchGrowPrayerGuide = {
  id: string
  month: string
  country: string
  pdf?: string
  hub: string
  requests: readonly string[]
}

/** Dated guide transcription from the prototype, not live ministry/country claims.
 * The official archive still lists this exact September 2026 Bangladesh PDF (checked 2026-10-17).
 * Its requests are numbered independently of calendar days; no clock relabels this guide.
 */
export const WATCH_GROW_PRAYER: WatchGrowPrayerGuide = {
  id: "2026-09-bangladesh",
  month: "September 2026",
  country: "Bangladesh",
  pdf: "https://www.jesusfilm.org/wp-content/uploads/2026/08/JFP-Prayer-Guide-2026-09.pdf",
  hub: "https://www.jesusfilm.org/partners/resources/pray/prayer-guides/",
  requests: [
    "Pray for the government of Bangladesh, for the honorable prime minister, the cabinet, administration, law and all government departments. May God give them wisdom to run the country with honesty and fairness.",
    "Pray for the Holy Spirit to guide Christians in Bangladesh to share the hope God has given them with their neighbors.",
    "Pray for all the pastors, priests and church leaders in Bangladesh. Ask the Holy Spirit to give them wisdom to lead wisely. Pray for the people they lead to have teachable hearts.",
    "Pray that Christian workers seeking to share Christ in new areas would build good relationships with any existing Christian communities in those places.",
    "As in many places, some religious traditions in Bangladesh can lead to harsh treatment toward those who have differing religious beliefs. Pray for Christian service organizations to use wisdom in sharing the message of Christ’s salvation as they do humanitarian work throughout the country.",
    "Pray that Bangladeshi people who do not yet know Jesus would recognize Him for who He is and see their need for Him. “Jesus answered, ‘I am the way and the truth and the life. No one comes to the Father except through Me.’” — John 14:6, NIV",
    "Many Bangladeshis are hesitant to learn about Jesus, or even to watch a movie about Him. Some believe that just watching a movie like this would make them a Christian. Ask God to remove the fear of learning about Jesus and to open their hearts to hearing His message.",
    "Pray for Christian workers and ministry teams in Bangladesh to be men and women of godly character: earnest in prayer, motivated by God’s love, passionate for holiness and striving for authentic community.",
    "Pray for all the local and national leaders of Bangladesh to work peaceably together for the good of the country and the people.",
    "Pray especially for those who are engaged in evangelism in different parts of Bangladesh to be wise and prudent as they encounter people.",
    "Like many believers around the world, many Christians in Bangladesh have been treated harshly, experiencing political, social and religious pressure due to their faith. Pray for God to transform the hearts of those who are mistreating others.",
    "Pray for Bangladeshi believers to seek after God with their whole hearts, and to spend more time reading the Bible, meditating and praying. May they grow in maturity as believers, follow the Holy Spirit’s guidance and love each other.",
    "Using Scripture is great to pray for yourself, your family and friends, not just for people far away. Pray this for every Christian in Bangladesh: “Since, then, you have been raised with Christ, set your hearts on things above, where Christ is, seated at the right hand of God. Set your minds on things above, not on earthly things.” — Colossians 3:1-2, NIV",
    "Pray for the Christian aid agencies working in Bangladesh to be able to express the true love of God.",
    "Many of the evangelism and discipleship activities in Bangladesh take place online using platforms like Zoom. Pray that this kind of evangelism will be effective, and that those leading others online will use creativity, wisdom and skill to navigate in this digital ministry space.",
    "Pray for Bangladeshi Christians to strive for higher education in order to seek opportunities to hold high positions in government as God leads. Christians in these high positions can be witnesses and great influences for Christ.",
    "Pray for ministry leaders in Bangladesh to lead and guide God’s people with integrity of heart and with skillful hands.",
    "Pray for the Holy Spirit to lead Christians in Bangladesh to witness to others about Christ and for them to focus on making disciples of all nations.",
    "There are some people in Bangladesh who try to bring about change to institutions or to society in destructive ways. Ask God to prevent these people from causing further harm. Pray that God would reveal Himself to them, so they may know He is the one true God who can bring about change for the good of all through His love, hope and peace.",
    "The Bible teaches us that we have an enemy (the devil) who wants to keep Christians from trusting God. God wants us to stay close to Him and let Him fight for us. The Christians in Bangladesh need to do this as well, so join me in praying God’s word for them. “Be alert and of sober mind. Your enemy the devil prowls around like a roaring lion looking for someone to devour. Resist him, standing firm in the faith…” —1 Peter 5:8-9, NIV",
    "Pray for the Lord’s miraculous provision for the ministry and for the personal needs of Christian workers in Bangladesh.",
    "Pray that Christian websites would be safe places for people to learn about God and to help advance God's kingdom. Pray for these websites to be safe from hackers and from those who want to stop the sharing of the gospel.",
    "There are many local and foreign aid agencies working to provide services to refugees in Bangladesh. Pray that Christian service organizations can spread the message of God’s love and salvation through Jesus to these displaced people.",
    "Ask God to bless those who are praying for and giving financially to support Christian ministry in Bangladesh. May He multiply their resources as they faithfully give to His work.",
    "Ask that God would help Christians in Bangladesh effectively model love for God and His Word to young believers and train them in the basics of Christian living.",
    "Ask that Bangladeshi Christian workers may never lose their first love as described in Revelation chapter 2. May their ministry flow out of their love for God. Pray that they will never lose heart when God allows them to go through various challenges, like financial difficulties, lack of ministry results, health issues, issues related to their kids, etc. Pray that God will strengthen them to get through these circumstances and for them to never compromise on their commitment to Him.",
    "“How, then, can they call on the One they have not believed in? And how can they believe in the One of whom they have not heard? And how can they hear without someone preaching to them? And how can anyone preach unless they are sent? As it is written: ‘How beautiful are the feet of those who bring good news!’” — Romans 10:14-15, NIV",
    "Please pray for ongoing equipping and training of Bangladeshi pastors throughout the country.",
    "Jesus-centered films are sometimes broadcast on television throughout Bangladesh! Pray that many would tune in and discover new life in Christ.",
    "Pray for Christian leaders to help their people grow strong in their faith and in their desire to join God in the work He’s doing in Bangladesh.",
    "Lord Jesus, we thank You for giving us a chance to pray for Bangladesh each day this month. We believe You will continue Your work there until everyone has heard clearly about Jesus and been invited to follow Him. Someday we’ll see how You answered our prayers. May heaven be filled with Bangladeshis who started to follow Jesus in part due to our prayers this month. We give you all honor and praise.",
  ],
}
