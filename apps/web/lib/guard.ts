import { notFound } from 'next/navigation';
import { NotFoundError } from './api';

/** Converts API 404s into the Next.js not-found page. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}
