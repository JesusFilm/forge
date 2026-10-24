// Matthew 24:14 from public-domain editions distributed by eBible.org.
// IDs resolve at https://ebible.org/find/show.php?id={id}; the Greek entry is
// the public-domain 1904 Patriarchal Greek New Testament source text.
type VerseTranslation = {
  id: string
  language: string
  text: string
  direction: "ltr" | "rtl"
}

export const VERSE_REFERENCE = "Matthew 24:14"
export const VERSE_TRANSLATIONS: readonly VerseTranslation[] = [
  {
    id: "arb-vd",
    language: "العربية",
    text: "وَيُكْرَزُ بِبِشَارَةِ ٱلْمَلَكُوتِ هَذِهِ فِي كُلِّ ٱلْمَسْكُونَةِ شَهَادَةً لِجَمِيعِ ٱلْأُمَمِ. ثُمَّ يَأْتِي ٱلْمُنْتَهَى.",
    direction: "rtl",
  },
  {
    id: "bla",
    language: "Siksiká",
    text: "Ki am'ok nĭn'naiisĭnni ĭstŏkh'sitsĭniksĭnni ak'anĭstop kŏnŭs'ksŏkkum, kŏnai'okoaua mŏks'ksĭniĭsauaie; ki umuk'itsipi ak'otŭmitoto.",
    direction: "ltr",
  },
  {
    id: "breBRG",
    language: "Brezhoneg",
    text: "An Aviel-mañ eus ar rouantelezh a vo prezeget er bed a-bezh, evit reiñ testeni d'an holl bobloù; neuze e teuio ar fin.",
    direction: "ltr",
  },
  {
    id: "cekak",
    language: "Asang Khongca",
    text: "Acaeng kaminawk boih khaeah hnukung ah oh hanah, hae kahoih siangpahrang ukhaih prae tamthanglok hae long pum ah thuih ah om tih; to pacoengah ni boenghaih to pha vop tih.",
    direction: "ltr",
  },
  {
    id: "ces1613",
    language: "český",
    text: "A budeť kázáno toto evangelium království po všem světě, na svědectví všem národům, a tehdážť přijde skonání.",
    direction: "ltr",
  },
  {
    id: "cha",
    language: "Chamorro",
    text: "Ya umapredica este y ebangelion y raeno gui todo y tano, para testimonio gui todo y nasion, ya ayo nae ufato y jinecog.",
    direction: "ltr",
  },
  {
    id: "cmn-cu89s",
    language: "中国语文",
    text: "这天国的福音要传遍天下，对万民作见证，然后末期才来到。」",
    direction: "ltr",
  },
  {
    id: "copbhc",
    language: "ⲘⲉⲧⲢⲉⲙ̀ⲛⲭⲏⲙⲓ",
    text: "ⲞⲨⲞϨ ⲈⲨⲈϨⲒⲰⲒϢ ⲘⲠⲀⲒⲈⲨⲀⲄⲄⲈⲖⲒⲞⲚ ⲚⲦⲈϮⲘⲈⲦⲞⲨⲢⲞ ϦⲈⲚϮⲞⲒⲔⲞⲨⲘⲈⲚⲎ ⲦⲎⲢⲤ ⲈⲨⲘⲈⲦⲘⲈⲐⲢⲈ ⲚⲚⲒⲈⲐⲚⲞⲤ ⲦⲎⲢⲞⲨ ⲦⲞⲦⲈ ⲈⲤⲈⲒ ⲚϪⲈϮϦⲀⲎ.",
    direction: "ltr",
  },
  {
    id: "deu1912",
    language: "Deutsch",
    text: "Und es wird gepredigt werden das Evangelium vom Reich in der ganzen Welt zu einem Zeugnis über alle Völker, und dann wird das Ende kommen.",
    direction: "ltr",
  },
  {
    id: "dif",
    language: "Dieri",
    text: "Ja tanali ninapini ngantjani jaura mililandru mita maruni kaukaubala nganai, kana warupotuni malka nganananto, ja ngadani mudani wokarala nganai.",
    direction: "ltr",
  },
  {
    id: "engwebp",
    language: "English",
    text: "This Good News of the Kingdom will be preached in the whole world for a testimony to all the nations, and then the end will come.",
    direction: "ltr",
  },
  {
    id: "epo",
    language: "Esperanto",
    text: "Kaj ĉi tiu evangelio de la regno estos predikita tra la tuta mondo, kiel atesto al ĉiuj nacioj; kaj tiam venos la fino.",
    direction: "ltr",
  },
  {
    id: "fraLSG",
    language: "français",
    text: "Cette bonne nouvelle du royaume sera prêchée dans le monde entier, pour servir de témoignage à toutes les nations. Alors viendra la fin.",
    direction: "ltr",
  },
  {
    id: "grcbyz",
    language: "Ελληνικά",
    text: "καὶ κηρυχθήσεται τοῦτο τὸ εὐαγγέλιον τῆς βασιλείας ἐν ὅλῃ τῇ οἰκουμένῃ εἰς μαρτύριον πᾶσι τοῖς ἔθνεσι, καὶ τότε ἥξει τὸ τέλος.",
    direction: "ltr",
  },
  {
    id: "hat",
    language: "Kreyòl Ayisyen",
    text: "Fòk yo gen tan mache bay bon nouvèl Peyi kote Bondye Wa a toupatou sou latè, pou tout moun ka tande mesaj la. Se lè sa a atò lafen an va rive.",
    direction: "ltr",
  },
  {
    id: "haw1868",
    language: "'Olelo Hawai'i",
    text: "A e haiia'ku no keia euanelio o ke aupuni ma na wahi aukauaka a pau, i mea e ike ai na lahuikanaka a pau: alaila iho e hiki mai ka hopena.",
    direction: "ltr",
  },
  {
    id: "heb",
    language: "עברית",
    text: "ותקרא בשורת המלכות הזאת בתבל כלה לעדות לכל הגוים ואחר יבוא הקץ׃",
    direction: "rtl",
  },
  {
    id: "hlt",
    language: "Matupi Chin",
    text: "Te phoeiah ram kah olthangthen he namtom boeih taengah laipai la om sak ham lunglai pum boeih ah a hoe ni.Te daengah ni a bawtnah te ha pawk pueng eh.",
    direction: "ltr",
  },
  {
    id: "hrv",
    language: "Hrvatski",
    text: "“I propovijedat će se ovo evanđelje Kraljevstva po svem svijetu za svjedočanstvo svim narodima. Tada će doći svršetak.”",
    direction: "ltr",
  },
  {
    id: "ita1885",
    language: "Italiano",
    text: "E questo evangelo del regno sarà predicato in tutto il mondo, in testimonianza a tutte le genti; ed allora verrà la fine.",
    direction: "ltr",
  },
  {
    id: "jpn1965",
    language: "日本語",
    text: "この御国の福音は全世界に宣べ伝えられて、すべての国民にあかしされ、それから、終わりの日が来ます。",
    direction: "ltr",
  },
  {
    id: "kor",
    language: "한국인",
    text: "이 천국 복음이 모든 민족에게 증거되기 위하여 온 세상에 전파되리니 그제야 끝이 오리라",
    direction: "ltr",
  },
  {
    id: "kos",
    language: "Kosrae",
    text: "Ac Pweng Wo inge ke Tokosrai uh ac fah lutiyuk fin faclu nufon in mwe loh nu sin mwet nukewa; na faclu fah safla.",
    direction: "ltr",
  },
  {
    id: "latVUC",
    language: "Latine",
    text: "Et prædicabitur hoc Evangelium regni in universo orbe, in testimonium omnibus gentibus: et tunc veniet consummatio.",
    direction: "ltr",
  },
  {
    id: "mya",
    language: "Mynmar language",
    text: "နိုင်​ငံ​တော်​ဆိုင်​ရာ​သ​တင်း​ကောင်း​အ​ကြောင်း​ကို ကမ္ဘာ​တစ်​ဝန်း​လုံး​ရှိ​လူ​မျိုး​အ​ပေါင်း​တို့​အား သက်​သေ​ခံ​ဟော​ပြော​ပြီး​မှ​ကပ်​ကမ္ဘာ​ကုန်​ဆုံး ချိန်​ရောက်​လိမ့်​မည်။",
    direction: "ltr",
  },
  {
    id: "nld",
    language: "Nederlands",
    text: "En dit Evangelie des Koninkrijks zal in de gehele wereld gepredikt worden tot een getuigenis allen volken; en dan zal het einde komen.",
    direction: "ltr",
  },
  {
    id: "pesOPV",
    language: "فارسی",
    text: "و به این بشارت ملکوت در تمام عالم موعظه خواهد شد تا بر جمیع امت‌ها شهادتی شود؛ آنگاه انتها خواهد رسید.",
    direction: "rtl",
  },
  {
    id: "pon",
    language: "Pohnpeian",
    text: "A ronamau en wei o pan kalok jili nan jappa karoj, pwen kaded on wei karoj, iei anjau, me imwi korendo.",
    direction: "ltr",
  },
  {
    id: "porbrbsl",
    language: "Português",
    text: "Este Evangelho do Reino será pregado em todo o mundo como testemunho a todas as nações, e então virá o fim.",
    direction: "ltr",
  },
  {
    id: "ron1924",
    language: "Romanian",
    text: "Евангелияачаста а Ымпэрэцией вафи проповэдуитэ ын тоатэ лумя, ка сэ служяскэ де мэртурие тутурор нямурилор. Атунч ва вени сфыршитул.",
    direction: "ltr",
  },
  {
    id: "russyn",
    language: "русский",
    text: "И проповедано будет сие Евангелие Царствия по всей вселенной, во свидетельство всем народам; и тогда придет конец.",
    direction: "ltr",
  },
  {
    id: "spabll",
    language: "Español",
    text: "Y estas Buenas Noticias del Reino se anunciarán en todo el mundo, para que todas las naciones las conozcan. Entonces vendrá el fin.",
    direction: "ltr",
  },
  {
    id: "srp1865",
    language: "srpski jezik",
    text: "I propovediće se ovo jevanđelje o carstvu po svemu svetu za svedočanstvo svim narodima. I tada će doći posledak.",
    direction: "ltr",
  },
  {
    id: "swh1850",
    language: "Kiswahili",
    text: "Ila, kabla ya mwisho kufika, hii Habari Njema ya Ufalme wa Mungu itahubiriwa ulimwenguni kote kama ushuhuda kwa mataifa yote.",
    direction: "ltr",
  },
  {
    id: "thafb",
    language: "แบบไทย",
    text: "ข่าวดี​เรื่อง​อาณาจักร​นี้​จะ​ได้รับ​การประกาศ​ไป​ทั่ว​โลก เพื่อ​เป็น​พยาน​แก่​ทุกชนชาติ แล้ว​จุดจบ​จะ​มาถึง",
    direction: "ltr",
  },
  {
    id: "ton",
    language: "Tongan",
    text: "Pea ko e ongoongolelei ni ʻoe puleʻanga ʻe malangaʻaki ʻi māmani kotoa pē, ko e meʻa fakamoʻoni ki he puleʻanga kotoa pē, pea ʻe toki hoko mai ʻae ikuʻanga.",
    direction: "ltr",
  },
  {
    id: "ukr1871",
    language: "Українська",
    text: "І проповідувати меть ся євангелия царства по всїй вселеннїй на сьвідкуваннє всїм народам; і тодї прийде конець.",
    direction: "ltr",
  },
  {
    id: "ulk1902",
    language: "Meriam Mir",
    text: "A ko etomeret debe baselaia ra mer gaire ged narid, ko ikeli ageakarem gaire ged narid; iaueakai bakedilu abele mop ge tabarki.",
    direction: "ltr",
  },
  {
    id: "vie1934",
    language: "Tiếng Việt",
    text: "Tin Lành nầy về nước Đức Chúa Trời sẽ được giảng ra khắp đất, để làm chứng cho muôn dân. Bấy giờ sự cuối cùng sẽ đến.",
    direction: "ltr",
  },
] as const
