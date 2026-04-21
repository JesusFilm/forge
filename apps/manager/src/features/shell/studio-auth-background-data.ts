export type StudioAuthBackgroundImage = {
  id: string
  alt: string
  author: string
  blurHash: string | null
  color: string
  src: string
}

export const STUDIO_AUTH_BACKGROUND_COLLECTION_URL =
  "https://unsplash.com/collections/-hGwOknnJXk/aeral"

export const STUDIO_AUTH_BACKGROUND_IMAGES: StudioAuthBackgroundImage[] = [
  {
    id: "JewspZm-yZA",
    alt: "a view of a forested area with a mountain in the background",
    author: "Anton Volnuhin",
    blurHash: "L75P8oofRQR-pMWYf5ah9QRVt6t5",
    color: "#0c2626",
    src: "https://images.unsplash.com/photo-1707871219554-389ce1daaba7?ixid=M3wxMjA3fDB8MXxjb2xsZWN0aW9ufDF8LWhHd09rbm5KWGt8fHx8fDJ8fDE3NzY0NTE0MjB8&ixlib=rb-4.1.0&auto=format&fit=crop&w=1800&q=82",
  },
  {
    id: "oGq6cWIKljk",
    alt: "an aerial view of a green area with trees",
    author: "Alexander Gluschenko",
    blurHash: "L8F~izId4WD,WjIV-.N1D.%K-maf",
    color: "#a6a659",
    src: "https://images.unsplash.com/photo-1714409174477-c1be31217a56?ixid=M3wxMjA3fDB8MXxjb2xsZWN0aW9ufDJ8LWhHd09rbm5KWGt8fHx8fDJ8fDE3NzY0NTE0MjB8&ixlib=rb-4.1.0&auto=format&fit=crop&w=1800&q=82",
  },
  {
    id: "GvSok_RJL08",
    alt: "an aerial view of a river surrounded by trees",
    author: "Pavel Neznanov",
    blurHash: "L48gE8M$I;$N0$9_xsNbR%n$RlX8",
    color: "#262626",
    src: "https://images.unsplash.com/photo-1646384008442-b6f713748d82?ixid=M3wxMjA3fDB8MXxjb2xsZWN0aW9ufDN8LWhHd09rbm5KWGt8fHx8fDJ8fDE3NzY0NTE0MjB8&ixlib=rb-4.1.0&auto=format&fit=crop&w=1800&q=82",
  },
  {
    id: "orAYJZjOSLQ",
    alt: "Aerial view of arid desert landscape with road",
    author: "Bernd Dittrich",
    blurHash: "LMK0pf}@9ZNG-WWBNHNHs:R+R*s.",
    color: "#a68c8c",
    src: "https://images.unsplash.com/photo-1762369879305-59b7b00d8761?ixid=M3wxMjA3fDB8MXxjb2xsZWN0aW9ufDR8LWhHd09rbm5KWGt8fHx8fDJ8fDE3NzY0NTE0MjB8&ixlib=rb-4.1.0&auto=format&fit=crop&w=1800&q=82",
  },
  {
    id: "E9NPWGBXM9o",
    alt: "aerial-photography of city",
    author: "Virgyl Sowah",
    blurHash: "LBCiK*9^0}#mPBoKoLs.1Ns9$$Nx",
    color: "#404040",
    src: "https://images.unsplash.com/photo-1568025848823-86404cd04ad1?ixid=M3wxMjA3fDB8MXxjb2xsZWN0aW9ufDV8LWhHd09rbm5KWGt8fHx8fDJ8fDE3NzY0NTE0MjB8&ixlib=rb-4.1.0&auto=format&fit=crop&w=1800&q=82",
  },
  {
    id: "Fi5NHh3xbuM",
    alt: "blue car on brown dirt",
    author: "Matthew Hall",
    blurHash: "LPG@3.xZ0#afkpj@r?S29voLt6WC",
    color: "#a65940",
    src: "https://images.unsplash.com/photo-1614661884799-4e9c90bd399b?ixid=M3wxMjA3fDB8MXxjb2xsZWN0aW9ufDZ8LWhHd09rbm5KWGt8fHx8fDJ8fDE3NzY0NTE0MjB8&ixlib=rb-4.1.0&auto=format&fit=crop&w=1800&q=82",
  },
  {
    id: "ZUgNL4wR8ho",
    alt: "a bird flying over a sandy beach covered in sand",
    author: "Alex Diaz",
    blurHash: "L8H0|,K%0zIp?cS1xaoJbvs:xaWB",
    color: "#8c7373",
    src: "https://images.unsplash.com/photo-1634151296771-b23156777588?ixid=M3wxMjA3fDB8MXxjb2xsZWN0aW9ufDd8LWhHd09rbm5KWGt8fHx8fDJ8fDE3NzY0NTE0MjB8&ixlib=rb-4.1.0&auto=format&fit=crop&w=1800&q=82",
  },
  {
    id: "QIXiXotvqHg",
    alt: "an aerial view of a mountain range in the desert",
    author: "Alex Diaz",
    blurHash: "LAE26G0eNYoINYnjt8NL5Qt8sqRj",
    color: "#735973",
    src: "https://images.unsplash.com/photo-1634151296366-6951d7b079b7?ixid=M3wxMjA3fDB8MXxjb2xsZWN0aW9ufDh8LWhHd09rbm5KWGt8fHx8fDJ8fDE3NzY0NTE0MjB8&ixlib=rb-4.1.0&auto=format&fit=crop&w=1800&q=82",
  },
]

export function getRandomStudioAuthBackgroundImage() {
  return STUDIO_AUTH_BACKGROUND_IMAGES[
    Math.floor(Math.random() * STUDIO_AUTH_BACKGROUND_IMAGES.length)
  ]
}
