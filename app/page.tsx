import { redirect } from "next/navigation";

// The roadmap/welcome page is gone now that Dashboard is built (this file's
// own earlier comment said to do exactly this once it existed). "/" itself
// stays a real route rather than being deleted — sign-out and the /signin
// "already signed in" page both land here.
export default function HomePage() {
  redirect("/dashboard");
}
