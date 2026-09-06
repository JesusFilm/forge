# Video recommendations after cookie rejection

**Date:** 2026-08-26
**Question:** Can Watch continue recommending videos when a viewer chooses “Essential only,” and does another platform doing so make Forge's durable personalization cookie essential?
**Evidence standard:** Official platform documentation, legislation, and regulator guidance only. This is product research, not legal advice; rollout policy still needs counsel for each jurisdiction and audience.

---

## Conclusion

**Yes, Watch can keep showing recommendations after “Essential only.” No, that does not make cross-visit behavioral personalization essential.**

The clean product split is:

| Capability                                                                                | After “Essential only”                       | Why                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Semantic/contextual recommendations from the current video, locale, language, and catalog | **Keep on**                                  | They do not require a durable behavioral profile. YouTube likewise retains context-influenced, non-personalized content after personalization cookies are rejected.                                                                  |
| Adaptation within the current interaction                                                 | **Potentially keep on, narrowly**            | It must avoid non-essential device storage/access and still have an appropriate personal-data basis. An exempt security/session identifier should not be reused for personalization.                                                 |
| Cross-visit watch-history profile and profile-to-item recommendations                     | **Off until valid consent in EU/EEA and UK** | The purpose is content personalization, not technical delivery of the video service.                                                                                                                                                 |
| User-level recommendation measurement and experiments                                     | **Treat separately**                         | Operational delivery evidence, aggregate statistics, and person/profile-level learning have different necessity and consent analyses. Do not make measurement automatically essential by bundling it into the recommendation cookie. |

The legally relevant test is whether storage/access is **strictly necessary to provide the online service explicitly requested by the user**, not whether recommendations are valuable to the product. The ePrivacy Directive states that test directly ([Directive 2002/58/EC, Article 5(3)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02002L0058-20091219)). Current UK ICO guidance is even more specific: technical streaming can sometimes be exempt, but that exemption “does not extend to other purposes, such as content personalisation or usage monitoring” ([ICO, storage and access exceptions](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/)).

## What YouTube actually demonstrates

Google distinguishes contextual recommendations from durable personalization:

- Google categorizes a customized YouTube homepage and recommendations based on past views/searches under **Personalization**. It says `VISITOR_INFO1_LIVE` may enable that behavior.
- If personalization cookies are rejected, Google says non-personalized content and features may still be influenced by location, language, device type, or the content currently being viewed ([Google, How Google uses cookies](https://policies.google.com/technologies/cookies?hl=en-GB)).
- YouTube says the **current video is the main signal for Up Next**, while homepage recommendations primarily rely on watch history. With watch history off and no significant prior history, personalized Home recommendations disappear, but search, subscriptions, and Explore/trending remain ([YouTube, How recommendations work](https://support.google.com/youtube/answer/16089387?hl=en); [YouTube, watch-history controls](https://support.google.com/youtube/answer/95725?hl=en)).

Therefore, YouTube is strong precedent for this experience:

```text
Essential only
  -> video playback still works
  -> semantic/current-video suggestions still work
  -> editorial, popular, and trending fallbacks still work
  -> no durable watch-history-based profile personalization
```

It is **not** precedent for calling history/profile personalization essential. Google's own cookie documentation labels past-view/search recommendations as personalization. Cookie choices and signed-in account-history controls are also different mechanisms: YouTube may use Google Account activity depending on the viewer's account settings ([YouTube, recommendation controls](https://support.google.com/youtube/answer/6342839?hl=en)).

## Other video-platform evidence

Netflix is not a clean analogue for anonymous Watch visitors. Netflix provides an authenticated subscription service and says it uses account/profile information, viewing history, searches, and playback interactions to provide personalized recommendations ([Netflix Privacy Statement](https://help.netflix.com/en/legal/privacy)). New profiles initially receive a diverse and popular default set before enough behavior exists ([Netflix, How its recommendation system works](https://help.netflix.com/en/node/100639)). This supports always having a non-profile fallback, but Netflix's account/contract model does not determine whether Forge's anonymous browser identifier is strictly necessary.

Vimeo OTT documents recommendation rows that fall back to a sensible default for new or low-history viewers, and separately offers a banner that can reject non-essential cookies. Vimeo does not document whether history-based personalization continues after rejection, so it cannot establish the classification either ([Vimeo OTT recommendation rows](https://help.vimeo.com/hc/en-us/articles/47785866797713-Recommendation-rows-on-Vimeo-OTT); [Vimeo OTT cookie banner](https://help.vimeo.com/hc/en-us/articles/12426990708241-Setting-up-my-Vimeo-OTT-site-s-cookie-consent-banner)).

## Regulatory implications

### EU/EEA

Article 5(3) of the ePrivacy Directive requires consent for storing or accessing information on a user's device unless it is solely for communication transmission or strictly necessary for the explicitly requested service ([Directive 2002/58/EC](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02002L0058-20091219)). The Article 29 Working Party's official exemption opinion treats this as a narrow test and distinguishes user-requested interface preferences from broader tracking ([Opinion 04/2012 on Cookie Consent Exemption](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2012/wp194_en.pdf)). Any subsequent processing of an identifiable or pseudonymous behavioral profile also needs its own GDPR lawful basis, transparency, retention, and data-subject controls.

### United Kingdom

ICO guidance says necessity is assessed from the user's perspective and at a technical level; helpful or commercially important is not enough. It identifies authentication, security, consent-choice storage, and some technical streaming as potential exemptions, but expressly excludes content personalization and usage monitoring from the streaming exemption. It also warns that an otherwise exempt identifier loses the exemption when used for secondary purposes ([ICO, exceptions](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/); [ICO, cookies and similar technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/)).

Current UK rules include a constrained statistical-purpose exception with notice and a simple, free objection mechanism. It covers aggregate service-improvement statistics, not identifying, tracking, monitoring, retaining individual-level data after aggregation, or making decisions about a person/profile. Forge's profile-level outcome learning should not be assumed to fit that exception ([ICO, statistical-purpose exception](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/)).

### California contrast

California does not use the same EU/UK “non-essential cookie requires prior consent” framework for adults. Covered businesses instead have notice, access, deletion, correction, and non-discrimination duties, plus an opt-out for sale or sharing—including Global Privacy Control. “Sharing” is specifically tied to cross-context behavioral advertising ([California Attorney General, CCPA](https://oag.ca.gov/privacy/ccpa)). A first-party, non-advertising recommendation profile may therefore permit a different regional posture, but that requires a California-specific review, especially for children, sensitive inferences, and any vendors or cross-service data sharing. It does not make global default-on lawful.

## Recommended Forge consent behavior

Use the selected three-action banner, but define **Essential only** as “non-personalized recommendations,” not “no recommendations”:

1. Before consent, serve the semantic/current-video slate and safe editorial/popularity fallbacks.
2. Do not create or read the durable recommendation-profile identifier, cross-visit history, or profile projection.
3. On **Accept all**, enable durable first-party profile personalization and record the choice; then dismiss the banner.
4. On **Essential only**, record only the consent preference needed to honor that choice; then dismiss the banner.
5. Keep **Cookie settings** available so consent can be changed or withdrawn. Withdrawal must stop profile use and invoke the existing profile privacy lifecycle.
6. Keep technical playback/security cookies purpose-limited. Do not reuse them as hidden personalization identifiers.
7. Separate aggregate service health from profile-level experimentation and learning in the consent inventory.

For a single worldwide policy, the defensible baseline is therefore **contextual recommendations always available; cross-visit personalization opt-in**. A region-aware default-on profile may be possible in some jurisdictions, but should only ship after counsel approves the jurisdiction detection, privacy notices, children policy, vendor flows, and data-subject controls.
