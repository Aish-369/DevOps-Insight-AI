
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronRight,
  Crown,
  FolderKanban,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";

import "../styles/TeamsPage.css";

// Available workspace roles.
type TeamRole = "Owner" | "Admin" | "Member";

// Information stored for each team member.
type TeamMember = {
  id: number;
  name: string;
  email: string;
  initials: string;
  role: TeamRole;
  color: string;
};

// Information stored for each workspace.
type Team = {
  id: number;
  name: string;
  description: string;
  initials: string;
  color: string;
  members: TeamMember[];
  projects: number;
};

// Sample data for the UI preview.
// This data is not saved to Supabase.
const initialTeams: Team[] = [
  {
    id: 1,
    name: "Platform Engineering",
    description: "Core infrastructure, CI/CD and developer experience.",
    initials: "PE",
    color: "lavender",
    projects: 8,
    members: [
      {
        id: 1,
        name: "Aishwarya Pawar",
        email: "you@example.com",
        initials: "AP",
        role: "Owner",
        color: "purple",
      },
      {
        id: 2,
        name: "Rohan Kulkarni",
        email: "rohan@example.com",
        initials: "RK",
        role: "Admin",
        color: "blue",
      },
      {
        id: 3,
        name: "Neha Shah",
        email: "neha@example.com",
        initials: "NS",
        role: "Member",
        color: "peach",
      },
    ],
  },
  {
    id: 2,
    name: "Client Delivery",
    description:
      "Deployment health and delivery workflows for client projects.",
    initials: "CD",
    color: "mint",
    projects: 5,
    members: [
      {
        id: 1,
        name: "Aishwarya Pawar",
        email: "you@example.com",
        initials: "AP",
        role: "Owner",
        color: "purple",
      },
      {
        id: 4,
        name: "Arjun Deshmukh",
        email: "arjun@example.com",
        initials: "AD",
        role: "Member",
        color: "green",
      },
    ],
  },
  {
    id: 3,
    name: "Product & QA",
    description: "Release readiness, test automation and product quality.",
    initials: "PQ",
    color: "peach",
    projects: 3,
    members: [
      {
        id: 1,
        name: "Aishwarya Pawar",
        email: "you@example.com",
        initials: "AP",
        role: "Owner",
        color: "purple",
      },
      {
        id: 5,
        name: "Mira Joshi",
        email: "mira@example.com",
        initials: "MJ",
        role: "Member",
        color: "blue",
      },
      {
        id: 6,
        name: "Dev Patel",
        email: "dev@example.com",
        initials: "DP",
        role: "Member",
        color: "green",
      },
      {
        id: 7,
        name: "Sara Khan",
        email: "sara@example.com",
        initials: "SK",
        role: "Admin",
        color: "peach",
      },
    ],
  },
];

export default function TeamsPage() {
  // Store workspace data in React state.
  const [teams, setTeams] = useState<Team[]>(initialTeams);

  // Track the currently selected workspace.
  const [activeTeamId, setActiveTeamId] = useState(1);

  // Search and filter state.
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All roles");

  // Control the create and invite forms.
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);

  // Create workspace form values.
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");

  // Invite member form values.
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<"Admin" | "Member">("Member");

  // Temporary notification message.
  const [notice, setNotice] = useState("");

  // Automatically hide notifications after 3.5 seconds.
  useEffect(() => {
    if (!notice) return;

    const timeoutId = window.setTimeout(() => {
      setNotice("");
    }, 3500);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  // Find the selected workspace.
  const activeTeam =
    teams.find((team) => team.id === activeTeamId) ?? teams[0];

  // Search workspaces by name or description.
  const filteredTeams = useMemo(
    () =>
      teams.filter((team) =>
        `${team.name} ${team.description}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [teams, search],
  );

  // Search and filter members in the selected workspace.
  const filteredMembers = activeTeam.members.filter(
    (member) =>
      `${member.name} ${member.email}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (roleFilter === "All roles" || member.role === roleFilter),
  );

  // Count unique member IDs across all workspaces.
  const totalMembers = new Set(
    teams.flatMap((team) => team.members.map((member) => member.id)),
  ).size;

  // Count projects across all workspaces.
  const totalProjects = teams.reduce(
    (sum, team) => sum + team.projects,
    0,
  );

  // Create a workspace in the local preview.
  function handleCreateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanName = teamName.trim();

    if (!cleanName) {
      setNotice("Please enter a workspace name.");
      return;
    }

    // Prevent duplicate workspace names.
    const alreadyExists = teams.some(
      (team) => team.name.toLowerCase() === cleanName.toLowerCase(),
    );

    if (alreadyExists) {
      setNotice("A workspace with this name already exists.");
      return;
    }

    const newTeam: Team = {
      id: Date.now(),
      name: cleanName,
      description:
        teamDescription.trim() ||
        "A new workspace for your team's projects.",
      initials: cleanName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase(),
      color: "lavender",
      projects: 0,
      members: [
        {
          id: Date.now() + 1,
          name: "Aishwarya Pawar",
          email: "you@example.com",
          initials: "AP",
          role: "Owner",
          color: "purple",
        },
      ],
    };

    setTeams((current) => [newTeam, ...current]);
    setActiveTeamId(newTeam.id);
    setTeamName("");
    setTeamDescription("");
    setSearch("");
    setRoleFilter("All roles");
    setShowCreateForm(false);
    setShowInviteForm(false);
    setNotice(`"${cleanName}" was added to the local preview.`);
  }

  // Open the invite form and clear old input.
  function handleOpenInviteForm() {
    setInviteEmail("");
    setInviteRole("Member");
    setShowInviteForm(true);
    setNotice("");
  }

  // Add a member to the selected workspace preview.
  function handleInviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanEmail = inviteEmail.trim().toLowerCase();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Validate the email address.
    if (!emailPattern.test(cleanEmail)) {
      setNotice("Please enter a valid email address.");
      return;
    }

    // Check whether this email already exists in the workspace.
    const alreadyMember = activeTeam.members.some(
      (member) => member.email.toLowerCase() === cleanEmail,
    );

    if (alreadyMember) {
      setNotice("This email already belongs to the selected workspace.");
      return;
    }

    // Generate a display name from the email address.
    const emailName = cleanEmail.split("@")[0];
    const displayName = emailName
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());

    const initials =
      displayName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase() || "TM";

    const newMember: TeamMember = {
      id: Date.now(),
      name: displayName,
      email: cleanEmail,
      initials,
      role: inviteRole,
      color: "blue",
    };

    // Update only the selected workspace.
    setTeams((currentTeams) =>
      currentTeams.map((team) =>
        team.id === activeTeamId
          ? { ...team, members: [...team.members, newMember] }
          : team,
      ),
    );

    setInviteEmail("");
    setInviteRole("Member");
    setShowInviteForm(false);

    setNotice(
      `${cleanEmail} was added as ${inviteRole}. No email was sent.`,
    );
  }

  return (
    <main className="teams-page">
      <div className="teams-container">
        <Link to="/dashboard" className="teams-back-link">
          <ArrowLeft size={17} />
          Back to dashboard
        </Link>

        {/* Page header */}
        <header className="teams-header">
          <div>
            <p className="teams-eyebrow">
              DEVOPS INSIGHT AI / WORKSPACE
            </p>

            <h1>Teams &amp; workspaces</h1>

            <p className="teams-subtitle">
              Organize projects, collaborate with your team, and keep
              delivery work in one place.
            </p>
          </div>

          <button
            className="teams-primary-button"
            type="button"
            onClick={() => {
              setShowCreateForm(true);
              setNotice("");
            }}
          >
            <Plus size={18} />
            Create team
          </button>
        </header>

        {/* Temporary toast notification */}
        {notice && (
          <div className="teams-toast" role="status">
            <Check size={18} />

            <span>{notice}</span>

            <button
              type="button"
              className="teams-toast-close"
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Create workspace form */}
        {showCreateForm && (
          <section
            className="teams-create-panel"
            aria-labelledby="create-team-title"
          >
            <div className="teams-create-heading">
              <div>
                <h2 id="create-team-title">Create a workspace</h2>
                <p>Give your team a clear name and purpose.</p>
              </div>

              <button
                className="teams-icon-button"
                type="button"
                aria-label="Close create team form"
                onClick={() => setShowCreateForm(false)}
              >
                <X size={19} />
              </button>
            </div>

            <form className="teams-create-form" onSubmit={handleCreateTeam}>
              <label>
                Team name <span aria-hidden="true">*</span>
                <input
                  autoFocus
                  maxLength={60}
                  required
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  placeholder="e.g. Backend Engineering"
                />
              </label>

              <label>
                Description{" "}
                <span className="teams-optional">(optional)</span>
                <input
                  maxLength={140}
                  value={teamDescription}
                  onChange={(event) =>
                    setTeamDescription(event.target.value)
                  }
                  placeholder="What will this team work on?"
                />
              </label>

              <div className="teams-form-actions">
                <button
                  className="teams-secondary-button"
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </button>

                <button className="teams-primary-button" type="submit">
                  <Plus size={17} />
                  Create preview team
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Compact workspace summary */}
        <section className="teams-metrics" aria-label="Workspace summary">
          <article className="teams-metric-card">
            <span className="teams-metric-icon purple">
              <Building2 size={20} />
            </span>

            <div>
              <p>Workspaces</p>
              <strong>{teams.length}</strong>
            </div>

            <span className="teams-metric-caption">
              Across your account
            </span>
          </article>

          <article className="teams-metric-card">
            <span className="teams-metric-icon blue">
              <Users size={20} />
            </span>

            <div>
              <p>Unique members</p>
              <strong>{totalMembers}</strong>
            </div>

            <span className="teams-metric-caption">
              Across all teams
            </span>
          </article>

          <article className="teams-metric-card">
            <span className="teams-metric-icon green">
              <FolderKanban size={20} />
            </span>

            <div>
              <p>Projects</p>
              <strong>{totalProjects}</strong>
            </div>

            <span className="teams-metric-caption">
              Sample workspace data
            </span>
          </article>
        </section>

        <div className="teams-content-grid">
          {/* Workspace list */}
          <section className="teams-panel teams-list-panel">
            <div className="teams-panel-heading">
              <div>
                <h2>Your workspaces</h2>
                <p>Select a workspace to view its members.</p>
              </div>

              <span className="teams-count-pill">
                {filteredTeams.length}
              </span>
            </div>

            <label className="teams-search">
              <Search size={17} />
              <span className="teams-sr-only">Search workspaces</span>

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search workspaces or members"
              />
            </label>

            <div className="teams-list">
              {filteredTeams.map((team) => (
                <button
                  type="button"
                  key={team.id}
                  className={`teams-list-item ${
                    activeTeamId === team.id ? "selected" : ""
                  }`}
                  onClick={() => {
                    setActiveTeamId(team.id);
                    setRoleFilter("All roles");
                    setShowInviteForm(false);
                    setNotice("");
                  }}
                >
                  <span
                    className={`teams-avatar teams-avatar-${team.color}`}
                  >
                    {team.initials}
                  </span>

                  <span className="teams-list-copy">
                    <strong>{team.name}</strong>
                    <small>
                      {team.members.length} members · {team.projects} projects
                    </small>
                  </span>

                  <ChevronRight
                    className="teams-list-chevron"
                    size={18}
                  />
                </button>
              ))}

              {filteredTeams.length === 0 && (
                <div className="teams-empty">
                  <Search size={23} />
                  <strong>No workspaces found</strong>
                  <span>Try another search term.</span>
                </div>
              )}
            </div>

            <button
              className="teams-add-workspace"
              type="button"
              onClick={() => {
                setShowCreateForm(true);
                setNotice("");
              }}
            >
              <Plus size={17} />
              Add another workspace
            </button>
          </section>

          {/* Selected workspace details */}
          <section className="teams-panel teams-detail-panel">
            <div className="teams-detail-top">
              <span
                className={`teams-avatar teams-avatar-${activeTeam.color} teams-avatar-large`}
              >
                {activeTeam.initials}
              </span>

              <div className="teams-detail-title">
                <p className="teams-detail-label">WORKSPACE DETAILS</p>

                <h2>{activeTeam.name}</h2>

                <p>{activeTeam.description}</p>
              </div>

              <button
                className="teams-icon-button"
                type="button"
                title="Workspace settings are coming soon"
                aria-label="Workspace settings (coming soon)"
                onClick={() =>
                  setNotice(
                    "Workspace settings will be available in a later update.",
                  )
                }
              >
                <ShieldCheck size={19} />
              </button>
            </div>

            {/* Selected workspace statistics */}
            <div className="teams-detail-stats">
              <div>
                <span>Members</span>
                <strong>{activeTeam.members.length}</strong>
              </div>

              <div>
                <span>Projects</span>
                <strong>{activeTeam.projects}</strong>
              </div>

              <div>
                <span>Your role</span>
                <strong>Owner</strong>
              </div>
            </div>

            {/* Members heading */}
            <div className="teams-members-heading">
              <div>
                <h3>Team members</h3>
                <p>People with access to this workspace</p>
              </div>

              <span className="teams-count-pill">
                {filteredMembers.length}
              </span>
            </div>

            {/* Member search and role filter */}
            <div className="teams-member-toolbar">
              <label className="teams-member-search">
                <Search size={15} />
                <span className="teams-sr-only">Search team members</span>

                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search members"
                />
              </label>

              <label className="teams-role-filter">
                <span className="teams-sr-only">Filter by role</span>

                <select
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value)}
                >
                  <option>All roles</option>
                  <option>Owner</option>
                  <option>Admin</option>
                  <option>Member</option>
                </select>
              </label>
            </div>

            {/* Invite member form appears only when requested */}
            {showInviteForm && (
              <section
                className="teams-create-panel"
                aria-labelledby="invite-member-title"
              >
                <div className="teams-create-heading">
                  <div>
                    <h2 id="invite-member-title">Add a team member</h2>
                    <p>Enter an email address and select a role.</p>
                  </div>

                  <button
                    className="teams-icon-button"
                    type="button"
                    aria-label="Close invitation form"
                    onClick={() => setShowInviteForm(false)}
                  >
                    <X size={19} />
                  </button>
                </div>

                <form
                  className="teams-create-form"
                  onSubmit={handleInviteMember}
                >
                  <label>
                    Email address <span aria-hidden="true">*</span>

                    <input
                      type="email"
                      autoFocus
                      required
                      maxLength={254}
                      value={inviteEmail}
                      onChange={(event) =>
                        setInviteEmail(event.target.value)
                      }
                      placeholder="name@company.com"
                    />
                  </label>

                  <label>
                    Workspace role

                    <select
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(event.target.value as "Admin" | "Member")
                      }
                    >
                      <option value="Member">Member</option>
                      <option value="Admin">Admin</option>
                    </select>
                  </label>

                  <div className="teams-form-actions">
                    <button
                      className="teams-secondary-button"
                      type="button"
                      onClick={() => setShowInviteForm(false)}
                    >
                      Cancel
                    </button>

                    <button
                      className="teams-primary-button"
                      type="submit"
                    >
                      <Plus size={17} />
                      Add member
                    </button>
                  </div>
                </form>
              </section>
            )}

            {/* Members table */}
            <div className="teams-table-wrap">
              <table className="teams-members-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Access</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredMembers.map((member) => (
                    <tr key={`${activeTeam.id}-${member.id}`}>
                      <td>
                        <div className="teams-member-cell">
                          <span
                            className={`teams-member-avatar ${member.color}`}
                          >
                            {member.initials}
                          </span>

                          <span>
                            <strong>{member.name}</strong>
                            <small>{member.email}</small>
                          </span>
                        </div>
                      </td>

                      <td>
                        <span
                          className={`teams-role-badge ${member.role.toLowerCase()}`}
                        >
                          {member.role === "Owner" && <Crown size={12} />}
                          {member.role}
                        </span>
                      </td>

                      <td>
                        <span className="teams-access-status">
                          <Check size={14} />
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredMembers.length === 0 && (
                <div className="teams-empty teams-member-empty">
                  <Users size={22} />
                  <strong>No members match</strong>
                  <span>Change the search or role filter.</span>
                </div>
              )}
            </div>

            {/* Member count and invitation action */}
            <div className="teams-members-footer">
              <span>
                Showing {filteredMembers.length} of {activeTeam.members.length}{" "}
                members
              </span>

              <button
                type="button"
                className="teams-invite-button"
                onClick={() => {
                  if (showInviteForm) {
                    setShowInviteForm(false);
                  } else {
                    handleOpenInviteForm();
                  }
                }}
              >
                {showInviteForm ? <X size={16} /> : <Plus size={16} />}
                {showInviteForm ? "Cancel invitation" : "Invite members"}
              </button>
            </div>
          </section>
        </div>

        {/* Keep the footer short and unobtrusive. */}
        <footer className="teams-footer">
          <ShieldCheck size={16} />
          Secure invitations and persistent team data require backend integration.
        </footer>
      </div>
    </main>
  );
}
