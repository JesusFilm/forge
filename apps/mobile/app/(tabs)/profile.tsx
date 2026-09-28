import { LibraryDownloads } from "../../src/components/library/LibraryDownloads"
import { AccountSection } from "../../src/components/profile/AccountSection"
import { PrivacyPolicyButton } from "../../src/components/profile/PrivacyPolicyButton"

// The other external links (socials, Give, About, Contact, newsletter, Legal)
// are hidden for now; ProfileLinksSection stays on disk so they can return.
export default function ProfileScreen() {
  return (
    <LibraryDownloads
      header={<AccountSection />}
      title="My Downloads"
      footer={<PrivacyPolicyButton />}
    />
  )
}
