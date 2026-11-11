import { redirect } from 'next/navigation'

// /night was the preview address of the page that is now the home page. Old links land on /.
export default function NightRedirect() {
  redirect('/')
}
