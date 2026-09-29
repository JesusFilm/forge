import { LibraryDownloads } from "../../src/components/library/LibraryDownloads"
import { MyWatchHeader } from "../../src/components/profile/MyWatchHeader"
import { PrivacyPolicyButton } from "../../src/components/profile/PrivacyPolicyButton"

// ProfileScreen hides the other external links (socials, Give, About,
// Contact, newsletter, Legal) for now. ProfileLinksSection stays on disk so
// they can return.
export default function ProfileScreen() {
  return (
    <LibraryDownloads
      header={<MyWatchHeader />}
      title="My Downloads"
      footer={<PrivacyPolicyButton />}
    />
  )
}
