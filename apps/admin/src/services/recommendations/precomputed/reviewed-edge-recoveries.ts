/** Exact reviewed incidents. This list grants no automatic retry authority. */
export type ReviewedEdgeRecovery = {
  generationId: string
  generationInputDigest: string
  callId: string
  attemptId: string
  inputDigest: string
  membershipDigest: string
  candidatePoolDigest: string
  captureRefDigest: string
  requestDigest?: string
  spanOfferDigest?: string
  selectedCorpusDigest?: string
  members: Array<{
    sourceVideoId: string
    pageIndex: number
    firstRank: number
    candidateCount: number
    checkpointRevision?: number
    sourceProfileKey?: string
    candidatePageDigest?: string
    sourceCandidateCount?: number
    sourceCandidateDigest?: string
    historicalRefDigest?: string
  }>
}
export const REVIEWED_EDGE_RECOVERIES: readonly ReviewedEdgeRecovery[] = [
  {
    generationId: "subscription-astra-budget2-20261008-v4",
    generationInputDigest:
      "36d168040f404b12e12be8d4ecdf8b75c102fe459bcefb22753f434fe29443b9",
    callId: "8ab8a620-1608-4115-812e-200bb2fb4b6d",
    attemptId: "6ef8681b-1607-4ae9-b0b1-c28c41225d6b",
    inputDigest:
      "d87ad22523187a6e2bdedbb6a948057fddaa9d18f7a1efe8bb3a3224587a8824",
    membershipDigest:
      "ec3d4b7ffdfad5bd1ef03d68a5577df2aa6b14969191e9de53b9a0ac8d983b72",
    candidatePoolDigest:
      "0780cfd0199c04f88076afcd7869140b56bca02b3253dd5d3c21cd0de4a8797a",
    captureRefDigest:
      "8edf8cce9a1ed5abf1ad847c47dd7f3389a9d1e431f8690ad9b3f0450b3e1cc8",
    members: [
      {
        sourceVideoId: "cmokmj8ka0njkqsccfvhbto3g",
        pageIndex: 0,
        firstRank: 0,
        candidateCount: 4,
      },
      {
        sourceVideoId: "cmokmjc390nk2qscc79tyun6g",
        pageIndex: 0,
        firstRank: 0,
        candidateCount: 4,
      },
    ],
  },
  {
    generationId: "production-astra-catalog-20261013-v6",
    generationInputDigest:
      "e2ad59bb95b497738290c6dee1d0dd487886f34019ea721ce6971e12dfddd3a5",
    callId: "0f532ef1-3358-42b8-859b-61957633f591",
    attemptId: "22039c49-4c1a-493b-b57d-51987e400ac3",
    requestDigest:
      "3f638ccdd9da3f7a7581f8c0bb3c88a101c8318dfc2da4fbe1f244ba669c6326",
    inputDigest:
      "f4f6bf5022c8ba534e164fa4ccdf00116b03cfedbd4af584a2c5c84c9f0918d9",
    membershipDigest:
      "dc94e09fb866618de1cec028cf27bdfb39694727a7342f0ce5b1df87f1a3aca7",
    spanOfferDigest:
      "85609a560fcf0b4a2a1a5c269c900ea9a99f3b33bfc40f52f32e01d8e267119e",
    selectedCorpusDigest:
      "9fb9ec705c19e0717894700447a13341859b41c8910fb374c4aa81dc14b755db",
    candidatePoolDigest:
      "0780cfd0199c04f88076afcd7869140b56bca02b3253dd5d3c21cd0de4a8797a",
    captureRefDigest:
      "8d08bd099643af363b7e089a0f763b8148cc95d45318ba4fa68ca43115be4567",
    members: [
      {
        sourceVideoId: "cmokmpysx0ohcqsccm3d7jssu",
        pageIndex: 10,
        checkpointRevision: 11,
        firstRank: 54,
        candidateCount: 4,
        sourceProfileKey:
          "f2f428f1c1c6830e4502b43fb01c652d9de921167bb881a83f037f41ede49755",
        candidatePageDigest:
          "1f535d0a1e6a1b72b23af23b1f2bc45d8d63c2f0e7713bb0bce6bc04662fc801",
        sourceCandidateCount: 58,
        sourceCandidateDigest:
          "b747cddd490e0f26f4cc0f975dc873e26558c6f30667443d3cb2b62054ac74d1",
        historicalRefDigest:
          "958e989ef0607a44183c972e2cdb85bde2e5bfbaa0f19d3b1ad6c61464e405ba",
      },
    ],
  },
  {
    generationId: "production-astra-catalog-20261013-v6",
    generationInputDigest:
      "e2ad59bb95b497738290c6dee1d0dd487886f34019ea721ce6971e12dfddd3a5",
    callId: "16540542-b0cd-4000-a1cf-300c11f5d721",
    attemptId: "811ff560-8617-4bab-bc2e-589e7746f0ca",
    requestDigest:
      "fc5c2e51934b3e2f8364b588c52466d030204e7e46f413d7a23e3d7a55562ee5",
    inputDigest:
      "9d030aa909383253b7f01b7bb22409d8062ba020e2b658f4acdbf7e524f18aac",
    membershipDigest:
      "5847dbd0dc17a58db2b3d6d496e9197877eaec1351a64dbfb31289a368319ec1",
    spanOfferDigest:
      "27140094404444794c94700d5de6e69f82dcec93c93d85f09c162763be2ee1c5",
    selectedCorpusDigest:
      "9fb9ec705c19e0717894700447a13341859b41c8910fb374c4aa81dc14b755db",
    candidatePoolDigest:
      "0780cfd0199c04f88076afcd7869140b56bca02b3253dd5d3c21cd0de4a8797a",
    captureRefDigest:
      "8d08bd099643af363b7e089a0f763b8148cc95d45318ba4fa68ca43115be4567",
    members: [
      {
        sourceVideoId: "cmokml1vs0nykqscc8bgble8n",
        pageIndex: 8,
        checkpointRevision: 9,
        firstRank: 43,
        candidateCount: 5,
        sourceProfileKey:
          "8d1269a832eca613f88d2182027d2968eeecac44a1c301582b72fbf05d7804f6",
        candidatePageDigest:
          "94913a2d07fe55fe735b87b9215b88783bfcda7925b32b7322e36553dfa49e2e",
        sourceCandidateCount: 50,
        sourceCandidateDigest:
          "effebe53d26413d7b76bc46b4356901f1352bc9d03580bbc45bb3900f236419b",
        historicalRefDigest:
          "0377df90c32fafa2e809b627cadbccf0661fbc6fe5e9b08583685a1c81b4c8ff",
      },
      {
        sourceVideoId: "cmokml41j0nz2qsccum7lf8kc",
        pageIndex: 8,
        checkpointRevision: 9,
        firstRank: 35,
        candidateCount: 5,
        sourceProfileKey:
          "94e76ecbc96ad1483fa530db0e4bf0957ee99097eaf9781f4ae3bc0a63dba374",
        candidatePageDigest:
          "32e72a0492b296c30d2b93f9be045be2bde3ba212b7655b511619c06f30577ef",
        sourceCandidateCount: 51,
        sourceCandidateDigest:
          "e2a597f2cdbbc836f00811437ecb574ef83db79a3573166a3c6720371ad605e5",
        historicalRefDigest:
          "61f75322e275ce4d619663fb757ddced112cb4a592f76c47d3161a9fc3cd59b5",
      },
    ],
  },
  {
    generationId: "production-astra-catalog-20261013-v6",
    generationInputDigest:
      "e2ad59bb95b497738290c6dee1d0dd487886f34019ea721ce6971e12dfddd3a5",
    callId: "1b52ddfd-6ec9-48c8-b87f-1f290c2e8125",
    attemptId: "310f62ba-afbe-4941-b43e-c28732fedcdf",
    requestDigest:
      "45bd4f2f0135a18a388d922f55e499991221f35350c3424490418699ca6def5f",
    inputDigest:
      "7c28804b2039d593a8ea1c5033b0e4b4004fd7a32a1c1c84add8f4718e2b7168",
    membershipDigest:
      "6a7ebdc02d519d72300059f31c743bd3cd5ae4b0307789a4564767873c952315",
    spanOfferDigest:
      "ba99664a7f972a8d43679e0bba1f947ab97ccc24b980cb547b96b99d89e45a40",
    selectedCorpusDigest:
      "9fb9ec705c19e0717894700447a13341859b41c8910fb374c4aa81dc14b755db",
    candidatePoolDigest:
      "0780cfd0199c04f88076afcd7869140b56bca02b3253dd5d3c21cd0de4a8797a",
    captureRefDigest:
      "8d08bd099643af363b7e089a0f763b8148cc95d45318ba4fa68ca43115be4567",
    members: [
      {
        sourceVideoId: "cmp76fdgi0010ny017qq1dmyq",
        pageIndex: 8,
        checkpointRevision: 9,
        firstRank: 40,
        candidateCount: 8,
        sourceProfileKey:
          "79b1e85fa70086f016c2cd52013a50e27b25cd7cf46286121449f8162500c4b4",
        candidatePageDigest:
          "ddb62415e04d5c34e961a85df9a95e0c6e226f71c79bcae0ee81c9447b53ecc1",
        sourceCandidateCount: 48,
        sourceCandidateDigest:
          "b65a79b44850eae6733d824ac5a1ada8d3da41d99e1b3c192416293d64723143",
        historicalRefDigest:
          "d4086007b0a00249ad7a9266e521cbfff3ed92b4214227d653a297dfafcbcd41",
      },
    ],
  },
  {
    generationId: "production-astra-catalog-20261013-v6",
    generationInputDigest:
      "e2ad59bb95b497738290c6dee1d0dd487886f34019ea721ce6971e12dfddd3a5",
    callId: "1c9be609-c76c-4828-8934-6e976ca135ce",
    attemptId: "310f62ba-afbe-4941-b43e-c28732fedcdf",
    requestDigest:
      "5476ad36bc23f4a21bf15b6bdfbe4cf75f7eabd9b59ccfaa1ce94a3685fc34d7",
    inputDigest:
      "077b756521b6d0892f0bb56661d6960c944519b45b2ab885dd5042ea2a6613fb",
    membershipDigest:
      "60dc5a1d615516d1f3b085de4a0f472aac394706564c18a587eba88e6fdab2c1",
    spanOfferDigest:
      "c165b9365c7733aace31ebf194346ea47a6059251317805fadd9bbd3bdd6527c",
    selectedCorpusDigest:
      "9fb9ec705c19e0717894700447a13341859b41c8910fb374c4aa81dc14b755db",
    candidatePoolDigest:
      "0780cfd0199c04f88076afcd7869140b56bca02b3253dd5d3c21cd0de4a8797a",
    captureRefDigest:
      "8d08bd099643af363b7e089a0f763b8148cc95d45318ba4fa68ca43115be4567",
    members: [
      {
        sourceVideoId: "cmp76huak0056ny01fdctsvy2",
        pageIndex: 4,
        checkpointRevision: 5,
        firstRank: 15,
        candidateCount: 7,
        sourceProfileKey:
          "395aef16f15d371637f444823012718477157398a2e423a5faf3c31036a7a826",
        candidatePageDigest:
          "4e18e818eee910d25e609522cb1f89de00e7a08af76a8cdf68eefe242b3ebb21",
        sourceCandidateCount: 50,
        sourceCandidateDigest:
          "4f81e5e83332163bf6da70b9522db258285f7f4c452953e4a4443332f5a73195",
        historicalRefDigest:
          "a56e7efc8148b881a460b66640d938371ec87dbff6af935de3183434dafa7ba5",
      },
    ],
  },
  {
    generationId: "production-astra-catalog-20261013-v6",
    generationInputDigest:
      "e2ad59bb95b497738290c6dee1d0dd487886f34019ea721ce6971e12dfddd3a5",
    callId: "23b3b0a0-af22-4f40-b499-790d84a3cb2c",
    attemptId: "22039c49-4c1a-493b-b57d-51987e400ac3",
    requestDigest:
      "9fb08a2fbd5d7bf46eb5120c87f10230e4d1b9be9ee329a2020ad85ce41beabc",
    inputDigest:
      "3ed9bafdb18cba1ca48838dd4e7cda1392e29e3a89f3185e0fbb8addc445bf00",
    membershipDigest:
      "c9ae8d5f4afa8f687ea38e6d586ec7d95e9bba47f8ac30b56117026834663db6",
    spanOfferDigest:
      "e45e28090d7e9dac6522cab11066dca06b232d60ec59c50f8dbc60e8b185e02b",
    selectedCorpusDigest:
      "9fb9ec705c19e0717894700447a13341859b41c8910fb374c4aa81dc14b755db",
    candidatePoolDigest:
      "0780cfd0199c04f88076afcd7869140b56bca02b3253dd5d3c21cd0de4a8797a",
    captureRefDigest:
      "8d08bd099643af363b7e089a0f763b8148cc95d45318ba4fa68ca43115be4567",
    members: [
      {
        sourceVideoId: "cmp76h0gs0044ny01kpsgjamo",
        pageIndex: 6,
        checkpointRevision: 7,
        firstRank: 24,
        candidateCount: 4,
        sourceProfileKey:
          "bb46f18cb2a5adc6c618e0186fddf3f768d1489eb0516032f459cff53214e5a7",
        candidatePageDigest:
          "b94ea37927f693639f7fed427da3715c9af59760965826e39f97cb20b1ab1142",
        sourceCandidateCount: 54,
        sourceCandidateDigest:
          "d99f6bd8990476631e2eafb571e96b25c79cba803cce657539d6a9aa98e21053",
        historicalRefDigest:
          "01e7c77cf96a4a0c58064b69279639bdb1d836319280e8bf7e7f482fc3fd3982",
      },
      {
        sourceVideoId: "cmp76h7zf004gny01dgda140w",
        pageIndex: 6,
        checkpointRevision: 7,
        firstRank: 20,
        candidateCount: 3,
        sourceProfileKey:
          "9f3fc0d60a6aec84672ff800df8d18c9c4e3e5544b24ded59767559561192b4a",
        candidatePageDigest:
          "250220e744ae7df4b15d8ab07c6bb31c7f11775267a6b5a311a114fd3f543a15",
        sourceCandidateCount: 51,
        sourceCandidateDigest:
          "51c5a8e6812e986e6bc4c675e9cea844b896873fd144964edac9f22b22fc2645",
        historicalRefDigest:
          "67476ac51c93af8e728fe1edea451a288953bc87b61f61027b60ee5eaa4e3d22",
      },
    ],
  },
  {
    generationId: "production-astra-catalog-20261013-v6",
    generationInputDigest:
      "e2ad59bb95b497738290c6dee1d0dd487886f34019ea721ce6971e12dfddd3a5",
    callId: "6cf1da28-020c-4ad2-9572-3bc4c91af9d5",
    attemptId: "310f62ba-afbe-4941-b43e-c28732fedcdf",
    requestDigest:
      "113414c59a2753baea033a69958fe5b09837f74ab1f5cfe5347bd614b65efaf3",
    inputDigest:
      "025f159091bd91684f1cf401d62db1e0573c1014783d8a9e2de72c3b7c1674fb",
    membershipDigest:
      "450c2b69409d76f9ab53e59cb30ef054abafd4db2e704e01d80894543732d26a",
    spanOfferDigest:
      "0631675013366930a0f2a5b70ddd87fc71a757bc6d9da7876b859878ab555407",
    selectedCorpusDigest:
      "9fb9ec705c19e0717894700447a13341859b41c8910fb374c4aa81dc14b755db",
    candidatePoolDigest:
      "0780cfd0199c04f88076afcd7869140b56bca02b3253dd5d3c21cd0de4a8797a",
    captureRefDigest:
      "8d08bd099643af363b7e089a0f763b8148cc95d45318ba4fa68ca43115be4567",
    members: [
      {
        sourceVideoId: "cmp76gs4a003qny010bcs7ag0",
        pageIndex: 8,
        checkpointRevision: 9,
        firstRank: 25,
        candidateCount: 8,
        sourceProfileKey:
          "1ea023653064cb23fcce38773706044fecb20942c8e1bc22c7f7058b66514e22",
        candidatePageDigest:
          "4aca8bbe2ebb02f39fe5c03183e23f4e68707e7c92377c7aac54c35514a0cfe9",
        sourceCandidateCount: 55,
        sourceCandidateDigest:
          "f99f60918c1b3614beb111c9148dbfe93f9b85c7e0c52302bd2affbe15d6e868",
        historicalRefDigest:
          "6fdd47fa82e453b658d572befb48bf61008bc2512c905fd106435788df314e62",
      },
    ],
  },
  {
    generationId: "production-astra-catalog-20261013-v6",
    generationInputDigest:
      "e2ad59bb95b497738290c6dee1d0dd487886f34019ea721ce6971e12dfddd3a5",
    callId: "beeba49b-0f6f-4d70-87c0-4d36a9e81f16",
    attemptId: "22039c49-4c1a-493b-b57d-51987e400ac3",
    requestDigest:
      "3235bcf6f1ad5f25a320865dbd9a0a1da9e6908593d622ee1773a8d1a5fe469d",
    inputDigest:
      "bbc30d9782c5b166739c6d450fd16889e6ccca2c8af6503489225d44fc078472",
    membershipDigest:
      "dcf2a42ed3a27ec4b9e63a4027f5e6d950c993d93d8304088951f136819567db",
    spanOfferDigest:
      "a4b714b24f37b87325af707de9fc9a1af1abdd47d54bdb9169b09666ae918659",
    selectedCorpusDigest:
      "9fb9ec705c19e0717894700447a13341859b41c8910fb374c4aa81dc14b755db",
    candidatePoolDigest:
      "0780cfd0199c04f88076afcd7869140b56bca02b3253dd5d3c21cd0de4a8797a",
    captureRefDigest:
      "8d08bd099643af363b7e089a0f763b8148cc95d45318ba4fa68ca43115be4567",
    members: [
      {
        sourceVideoId: "cmp76fz8p002iny01fjtsfju9",
        pageIndex: 8,
        checkpointRevision: 9,
        firstRank: 28,
        candidateCount: 3,
        sourceProfileKey:
          "266b735c0151fa619184460196d9d2f445f763a51921461ce21aa697d43b59ae",
        candidatePageDigest:
          "88de99e4ff093f51da2118195499ac515d669f3931f4d23050780988ac6b1537",
        sourceCandidateCount: 54,
        sourceCandidateDigest:
          "0d7c972e063ddc89065857dfabae62f86188d17af0e9396134fbe66db7031300",
        historicalRefDigest:
          "49e458cae405fc6768672cfa7fd2a31494ff76880e6cf19167a31bfb96bdd3d8",
      },
      {
        sourceVideoId: "cmp76g4q3002wny01very7csl",
        pageIndex: 8,
        checkpointRevision: 9,
        firstRank: 25,
        candidateCount: 2,
        sourceProfileKey:
          "f670de00baf76ca5ea530a4e54b5779ecc9d4314aee05e680d827fb13562bde1",
        candidatePageDigest:
          "a2b1e58d23d085a2cfecee4eb24f5a5081ea434f186ecc3a0dd324fd62b4f457",
        sourceCandidateCount: 56,
        sourceCandidateDigest:
          "dce6dc33311fe44b4f6c63340d4c396f35da6f5794a29120c8a8cce88bb6cfef",
        historicalRefDigest:
          "ef0cb8de1e380e754e4316c6f22f91edba4f6fcf3de605de9b8b6ad5d3b88f45",
      },
    ],
  },
]

export function reviewedEdgeRecovery(generationId: string, callId: string) {
  return REVIEWED_EDGE_RECOVERIES.find(
    (scope) => scope.generationId === generationId && scope.callId === callId,
  )
}
