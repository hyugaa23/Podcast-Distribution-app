// Tenant-specific robots.txt (PRD §37).
import { passthrough } from '@/lib/api';

export async function GET() {
  return passthrough('/robots.txt');
}
