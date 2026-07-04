import { Navigate, useParams } from 'react-router-dom';
import { SectionContent } from '../SectionContent.tsx';
import { getLastSection, isSection } from './sections.ts';

/** Redirect bare/unknown URLs to the last-visited (or default) section. */
export function SectionRedirect() {
  return <Navigate to={`/${getLastSection()}`} replace />;
}

/** Validate the `:section` path segment, then render its view (or redirect if unknown). */
export function SectionRoute() {
  const { section } = useParams();
  if (!isSection(section)) return <SectionRedirect />;
  return <SectionContent section={section} />;
}
