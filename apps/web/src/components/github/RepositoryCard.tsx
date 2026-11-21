
import {
  ArrowUpRight,
  GitFork,
  Star,
  Clock3,
  GitBranch,
} from "lucide-react";

import type { GitHubRepository } from "../../lib/github";

// The parent component passes one repository as a prop.
interface RepositoryCardProps {
  repository: GitHubRepository;
}

// Format the repository's last update date.
function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function RepositoryCard({
  repository,
}: RepositoryCardProps) {
  return (
    <article className="repo-card">
      <div className="repo-card-top">
        <div className="repo-card-icon">
          <GitBranch size={21} />
        </div>

        <span className="repo-visibility">
          {repository.visibility}
        </span>
      </div>

      <h3 className="repo-card-title">
        {repository.name}
      </h3>

      <p className="repo-card-description">
        {repository.description || "No description provided."}
      </p>

      <div className="repo-card-meta">
        <span>
          <span className="repo-language-dot" />
          {repository.language || "Not specified"}
        </span>

        <span>
          <Star size={15} />
          {repository.stargazers_count}
        </span>

        <span>
          <GitFork size={15} />
          {repository.forks_count}
        </span>
      </div>

      <div className="repo-card-bottom">
        <span className="repo-updated">
          <Clock3 size={14} />
          {formatDate(repository.updated_at)}
        </span>

        {/* Open the real repository on GitHub. */}
        <a
          href={repository.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="repo-open-link"
        >
          View repository
          <ArrowUpRight size={16} />
        </a>
      </div>
    </article>
  );
}
