type CTASectionProps = {
  id: string
  heading: string
  body: string
  buttonLabel: string
  buttonLink: string
}

export function CTASection({
  id,
  heading,
  body,
  buttonLabel,
  buttonLink,
}: CTASectionProps) {
  return (
    <section id={id} className="bg-gray-100 py-12">
      <div className="container mx-auto px-4 text-center">
        <h2 className="mb-4 text-2xl font-bold">{heading}</h2>
        <p className="mb-6 text-gray-700">{body}</p>
        <a
          href={buttonLink}
          className="inline-block rounded bg-gray-800 px-6 py-3 font-medium text-white hover:bg-gray-900"
        >
          {buttonLabel}
        </a>
      </div>
    </section>
  )
}
