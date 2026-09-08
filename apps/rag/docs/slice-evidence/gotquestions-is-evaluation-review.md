# GotQuestions Icelandic — candidate review

The operator delegated the relevance decisions to the agent using precedents from prior sources. **All 22 disagreements are resolved: 9 included, 13 excluded.** The draft contains six cases and 26 relevant pairs across 21 documents. The operator approved the six-case canonical append on 2026-09-08; all preceding 425 cases were preserved by that append. The canonical suite now contains 431 cases.

See [the precedent-backed decision record](./gotquestions-is-relevance-adjudication.md) for all 22 dispositions and reasons. That record preserves the distinction between substantive answers, generic gospel endings, and conversion material offered to a believer asking for discipleship steps.

## Adjudicated draft evaluation

| Case                           | English question                                                                                                 | First relevant rank | Relevant documents returned |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------: | --------------------------: |
| `gq-is-seeker-forgiveness`     | I am ashamed of what I have done. How can I receive God's forgiveness and start again?                           |                   1 |                        7/10 |
| `gq-is-skeptic-jesus-divinity` | Was Jesus just a good teacher, or are there biblical reasons to believe he is God?                               |                   1 |                         6/6 |
| `gq-is-skeptic-bible-trust`    | The Bible was written by people. Why should I trust that it is God's word?                                       |                   1 |                         1/1 |
| `gq-is-believer-recurring-sin` | I believe in Jesus but keep falling into the same sin. How can I resist it in daily life?                        |                   3 |                         1/2 |
| `gq-is-newcomer-next-steps`    | I have just begun believing in Jesus. What should I do next to grow in faith?                                    |                   1 |                         2/3 |
| `gq-is-seeker-purpose`         | My life feels empty even though things are going well. How can I find lasting purpose according to Christianity? |                   1 |                         3/4 |

Adjudicated draft metrics: recall@3 **1.000**, recall@10 **1.000**, coverage **0.769**, MRR **0.889**, P@1 **0.833**. The earlier 17-credit draft had coverage 0.925; the larger relevant sets expose additional missed documents. Questions, corpus, model, language, top-k 10, and minimum score 0.37 were unchanged. This is answer-key curation, not a matched-control regression comparison.

All 26 credits resolve exactly once to Icelandic documents. Questions and results retain the `llm-translated` evidence tier; no native-speaker verification is claimed. The initial three lenses shared one model, so their agreement was not independent human corroboration. The additional 22 document reviews used no retrieval output or original scores; the agent made the final precedent-based calls.

The previously recorded programming negative returned one false positive in its first check and both repeats. It was not rerun or relabeled in this adjudication, and the cutoff was not changed. No clean-negative or matched-control pass is claimed.

## Revised answer keys

### gq-is-seeker-forgiveness

Icelandic: Ég skammast mín fyrir það sem ég hef gert. Hvernig get ég fengið fyrirgefningu Guðs og byrjað upp á nýtt?

English: I am ashamed of what I have done. How can I receive God's forgiveness and start again?

Relevant documents:

- `/islenska/baen-syndara.html` — **What is the sinner's prayer?**. The sinner's prayer is a prayer to God acknowledging one's sinfulness and need for a Savior. It is only effective if it reflects genuine belief in one's sin and the need for salvation through Jesus Christ's atoning death and resurrection.
- `/islenska/vita-vissu-sina-himininn.html` — **How can I know for sure that I will go to heaven when I die?**. To be sure of eternal life, one must understand that sin separates us from God, but Jesus' death and resurrection provide forgiveness. Believing in Jesus Christ as Savior is the way to receive this gift of eternal life and assurance of heaven.
- `/islenska/thiggja-fyrirgefningu-Guds.html` — **How do I receive God's forgiveness?**. God offers forgiveness for sins because He loves us and Jesus died on the cross to pay the penalty for our sins. Receiving this forgiveness is a gift accepted through faith in Jesus Christ, not earned by works.
- `/islenska/fjogur-andleg-logmal.html` — **What are the Four Spiritual Laws?**. The Four Spiritual Laws outline a method for sharing the gospel of salvation through faith in Jesus Christ. They explain God's love and plan, humanity's sin and separation from God, Jesus Christ as God's provision for sin, and the necessity of receiving this gift through faith in Jesus.
- `/islenska/saettast-vid-Gud.html` — **How do I get right with God?**. To be reconciled with God, one must acknowledge sin, repent, and believe in Jesus Christ's atoning death and resurrection. This involves confessing sins, turning from sinful living, and trusting in God's promise of salvation through faith in Jesus.
- `/islenska/vegur-Romverjans-hjalpraedis.html` — **What is the Roman's Road to Salvation?**. The Romans Road develops the need for forgiveness, faith in Christ, repentance, and freedom from condemnation; forgiveness is its substance, not an appended invitation.
- `/islenska/ekki-fremja-sjalfsmord.html` — **Why should I not commit suicide?**. A substantive body section addresses grave past wrongdoing, repentance, forgiveness, and becoming new; its suicide-prevention framing does not erase that direct answer.
- `/islenska/eilift-lif.html` — **Do you have eternal life?**. The body develops sin, Christ’s sacrifice, repentance, and faith as the means of forgiveness; this is more than its concluding prayer.
- `/islenska/hjalprad.html` — **What is salvation?**. The salvation explanation connects separation caused by sin to forgiveness and restored relationship through Christ; that developed answer meets the question.
- `/islenska/hvao-naest.html` — **I have recently come to believe in Jesus... what next?**. Its substantial opening explanation of salvation and assurance explains how forgiveness is received, even though later sections address new believers.

### gq-is-skeptic-jesus-divinity

Icelandic: Var Jesús bara góður kennari, eða eru ástæður í Biblíunni til að trúa því að hann sé Guð?

English: Was Jesus just a good teacher, or are there biblical reasons to believe he is God?

Relevant documents:

- `/islenska/er-Jesus-Gud.html` — **Is Jesus God? Did Jesus claim to be God?**. The Bible presents Jesus as God, evidenced by His claims of unity with the Father, His acceptance of worship, and titles attributed to Him. His atoning death is sufficient for the sins of the world only if He is fully God.
- `/islenska/er-Gud-til.html` — **Does God exist?**. The document asserts Jesus' divine nature, citing His claims and the reactions of others as evidence. It argues that Jesus is either God, a lunatic, or a liar, and that His divinity is crucial for salvation.
- `/islenska/personulegur-Frelsari.html` — **What does it mean to receive Jesus as a personal Savior?**. Receiving Jesus as a personal Savior means understanding that Jesus is God incarnate, who died for our sins and rose again. It involves placing personal faith and trust in Him, not just in religious practices, to be saved.
- `/islenska/hver-Jesus-Kristur.html` — **Who is Jesus Christ?**. Jesus Christ was a historical figure, but the Bible presents him as more than a teacher or prophet, asserting his divine nature. His claims to be one with the Father and his use of the divine name 'I Am' indicate he is God, which is crucial for salvation as only God could pay the penalty for sin.
- `/islenska/Guthdomur-Krists.html` — **Is Christ's Divinity Biblical?**. The document argues that the Bible presents Jesus as divine, citing his own claims, his disciples' beliefs, and titles/actions attributed to him. It further supports this by detailing historical evidence for the resurrection, which is presented as the ultimate proof of his divinity.
- `/islenska/rett-tru-fyrir-mig.html` — **What is the right religion for me?**. The body develops Jesus’ authority and resurrection evidence, giving reasons to consider him more than an ordinary teacher.

### gq-is-skeptic-bible-trust

Icelandic: Biblían var skrifuð af mönnum. Af hverju ætti ég að treysta því að hún sé orð Guðs?

English: The Bible was written by people. Why should I trust that it is God's word?

Relevant documents:

- `/islenska/Biblian-Ord-Guds.html` — **Is the Bible really the Word of God?**. The Bible claims to be the Word of God, supported by internal evidence like its unity, fulfilled prophecies, and transformative power, as well as external evidence such as its historical accuracy and the integrity of its authors. Its endurance through centuries of opposition further testifies to its divine origin.

### gq-is-believer-recurring-sin

Icelandic: Ég trúi á Jesú en fell aftur og aftur í sömu syndina. Hvernig get ég barist gegn henni í daglegu lífi?

English: I believe in Jesus but keep falling into the same sin. How can I resist it in daily life?

Relevant documents:

- `/islenska/sigur-yfir-syndinni.html` — **How can I overcome sin in my Christian life?**. Overcoming sin involves relying on the Holy Spirit, engaging with God's Word (the Bible), consistent prayer, and the support of the church community. These resources empower believers to live a victorious Christian life by aligning their will with God's.
- `/islenska/Kristni.html` — **What is the Christian faith and what do Christians believe?**. The body explicitly addresses believers’ continuing struggle with sin and directs them to read and apply Scripture and follow the Spirit in daily life.

### gq-is-newcomer-next-steps

Icelandic: Ég er nýbyrjaður að trúa á Jesú. Hvað ætti ég að gera næst til að vaxa í trúnni?

English: I have just begun believing in Jesus. What should I do next to grow in faith?

Relevant documents:

- `/islenska/hvao-naest.html` — **I have recently come to believe in Jesus... what next?**. After accepting Jesus, it's important to understand salvation, find a Bible-believing church for community and teaching, establish daily spiritual disciplines like prayer and Bible reading, cultivate relationships with spiritually supportive people, and get baptized as a public declaration of faith.
- `/islenska/Kristni.html` — **What is the Christian faith and what do Christians believe?**. It moves beyond conversion to practical post-conversion guidance: apply Scripture, follow the Spirit, and live in fellowship and obedience.
- `/islenska/merking-lifsins.html` — **What is the meaning of life?**. The discipleship section explicitly recommends learning about Jesus, Bible reading, prayer, and obedience beyond initial belief.

### gq-is-seeker-purpose

Icelandic: Líf mitt virðist tómt þótt mér gangi vel. Hvernig get ég fundið varanlegan tilgang samkvæmt kristinni trú?

English: My life feels empty even though things are going well. How can I find lasting purpose according to Christianity?

Relevant documents:

- `/islenska/lif-eftir-daudann.html` — **Is there life after death?**. The Bible affirms life after death, with eternal life for believers and eternal punishment for unbelievers. Jesus Christ's resurrection is the cornerstone of this belief, offering eternal life through faith in him.
- `/islenska/hjalprad.html` — **What is salvation?**. Jesus is presented as the answer to life's emptiness, confusion, and search for purpose, offering himself as the bread of life, light, door, good shepherd, and resurrection. Salvation comes through faith in Jesus, who died for our sins and rose again.
- `/islenska/merking-lifsins.html` — **What is the meaning of life?**. The meaning of life is found in restoring fellowship with God through Jesus Christ, which was lost due to sin. True fulfillment comes from following Christ as a disciple, not just believing in Him.
- `/islenska/rett-tru-fyrir-mig.html` — **What is the right religion for me?**. Jesus is presented as the only way to salvation because He alone overcame death, unlike other religious founders. Believing in Jesus as Savior provides forgiveness, a meaningful relationship with God, and eternal life.

## Artifacts and next action

- Candidate YAML: `apps/rag/eval/candidates-gotquestions-is.yaml` (English translations, expected-document paraphrases, translated retrieved titles, and final exclusions).
- Latest metrics: `apps/rag/docs/slice-evidence/gotquestions-is-evaluation-adjudicated.json`.
- Original draft metrics: `apps/rag/docs/slice-evidence/gotquestions-is-evaluation-candidates.json`.
- Existing 425-case suite: `apps/rag/docs/slice-evidence/gotquestions-evaluation-current.json` (recall@10 0.991, coverage 0.816; zero Icelandic cases).

The operator approved and completed the canonical append and final closure on
2026-09-08. The full canonical rerun is recorded in
[`gotquestions-is-evaluation-canonical.json`](./gotquestions-is-evaluation-canonical.json):
all six Icelandic cases have a relevant result within the top three, coverage
0.769, MRR 0.917, and P@1 0.833. Its full 431-case recall@10 is 0.991.
The programming false positive is retained as a known limitation in `feat-467`;
no identity-matched regression comparison is available or claimed. All local
lifecycle stages are complete. No relevance disagreements remain unresolved.
