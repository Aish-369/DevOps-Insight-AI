
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
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

import { supabase } from "../lib/supabase";
import { resolveActiveWorkspaceId, saveActiveWorkspaceId } from "../lib/workspaceSelection.js";
import "../styles/TeamsPage.css";

type TeamRole = "Owner" | "Admin" | "Member";

type TeamMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  initials: string;
  role: TeamRole;
  color: string;
};

type PendingInvitation = {
  id: string;
  teamId: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
};

type Team = {
  id: string;
  name: string;
  description: string;
  initials: string;
  color: string;
  members: TeamMember[];
  projects: number;
  myRole: TeamRole;
};

const colors = ["lavender", "mint", "peach", "blue"];

// Generate initials for a workspace or member.
function getInitials(value: string) {
  return (
    value
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "TM"
  );
}

// Convert database roles into UI roles.
function mapRole(role: string): TeamRole {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

export default function TeamsPage() {
  // Actual workspace data loaded from Supabase.
  const [teams, setTeams] = useState<Team[]>([]);

  // Currently selected workspace.
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");

  // Independent search and filter states.
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All roles");

  // Create workspace form state.
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [memberActionKey, setMemberActionKey] = useState("");

  // Loading and notification states.
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Automatically hide notifications.
  useEffect(() => {
    if (!notice) return;

    const timeoutId = window.setTimeout(() => {
      setNotice("");
    }, 3500);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  // Load workspaces and their related database records.
  const loadTeams = useCallback(async () => {
    setLoading(true);

    try {
      // Get the currently authenticated user.
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) throw authError;

      if (!user) {
        setTeams([]);
        setActiveTeamId(null);
        setNotice("Please sign in to view your workspaces.");
        return;
      }
      setCurrentUserId(user.id);

      // Read the current user's profile.
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) throw profileError;

      const currentName =
        profile?.display_name ||
        user.user_metadata?.full_name ||
        user.email?.split("@")[0] ||
        "You";

      // Fetch workspaces visible to the current user.
      const { data: teamRows, error: teamsError } = await supabase
        .from("teams")
        .select("id, name, description, owner_id, created_at")
        .order("created_at", { ascending: false });

      if (teamsError) throw teamsError;

      const rows = teamRows ?? [];

      // Clear the page when the user has no workspaces.
      if (rows.length === 0) {
        setTeams([]);
        setPendingInvitations([]);
        setActiveTeamId(null);
        saveActiveWorkspaceId(user.id, null);
        return;
      }

      const teamIds = rows.map((team) => team.id);

      // Invitation rows are visible only to team owners and admins through RLS.
      const { data: invitationRows, error: invitationsError } = await supabase
        .from("team_invitations")
        .select("id, team_id, email, role, expires_at")
        .in("team_id", teamIds)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (invitationsError) throw invitationsError;
      setPendingInvitations((invitationRows ?? []).map((invitation) => ({
        id: invitation.id,
        teamId: invitation.team_id,
        email: invitation.email,
        role: invitation.role === "admin" ? "admin" : "member",
        expiresAt: invitation.expires_at,
      })));

      // Fetch actual memberships.
      const { data: memberRows, error: membersError } = await supabase
        .from("team_members")
        .select("id, team_id, user_id, role")
        .in("team_id", teamIds);

      if (membersError) throw membersError;

      // Fetch actual projects.
      const { data: projectRows, error: projectsError } = await supabase
        .from("team_projects")
        .select("id, team_id")
        .in("team_id", teamIds);

      if (projectsError) throw projectsError;

      const memberships = memberRows ?? [];
      const projects = projectRows ?? [];

      // Convert database records into the UI data structure.
      const mappedTeams: Team[] = rows.map((team, index) => {
        const teamMembers = memberships.filter(
          (member) => member.team_id === team.id,
        );

        const currentMembership = teamMembers.find(
          (member) => member.user_id === user.id,
        );

        const members: TeamMember[] = teamMembers.map(
          (member, memberIndex) => {
            const isCurrentUser = member.user_id === user.id;

            // Do not invent private profile details for other users.
            const displayName = isCurrentUser
              ? currentName
              : "Team member";

            return {
              id: member.id,
              userId: member.user_id,
              name: displayName,
              email: isCurrentUser ? user.email ?? "" : "",
              initials: getInitials(displayName),
              role: mapRole(member.role),
              color: isCurrentUser
                ? "purple"
                : colors[memberIndex % colors.length],
            };
          },
        );

        return {
          id: team.id,
          name: team.name,
          description:
            team.description || "No workspace description added.",
          initials: getInitials(team.name),
          color: colors[index % colors.length],
          members,
          projects: projects.filter(
            (project) => project.team_id === team.id,
          ).length,
          myRole: currentMembership
            ? mapRole(currentMembership.role)
            : team.owner_id === user.id
              ? "Owner"
              : "Member",
        };
      });

      setTeams(mappedTeams);

      // Preserve the selected workspace when it still exists.
      setActiveTeamId((currentId) => {
        const selectedId = resolveActiveWorkspaceId(user.id, currentId ?? "", mappedTeams);
        saveActiveWorkspaceId(user.id, selectedId);
        return selectedId;
      });
    } catch (error) {
      console.error("Workspace loading failed:", error);

      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to load workspaces.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Schedule the initial workspace load after the component mounts.
  // This avoids synchronously triggering state updates inside the effect.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadTeams();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadTeams]);

  // Find the selected workspace.
  const activeTeam =
    teams.find((team) => team.id === activeTeamId) ?? null;

  // Search workspaces independently.
  const filteredTeams = useMemo(
    () =>
      teams.filter((team) =>
        `${team.name} ${team.description}`
          .toLowerCase()
          .includes(workspaceSearch.toLowerCase()),
      ),
    [teams, workspaceSearch],
  );

  // Search and filter members in the selected workspace.
  const filteredMembers = useMemo(() => {
    if (!activeTeam) return [];

    return activeTeam.members.filter((member) => {
      const matchesSearch = `${member.name} ${member.email}`
        .toLowerCase()
        .includes(memberSearch.toLowerCase());

      const matchesRole =
        roleFilter === "All roles" || member.role === roleFilter;

      return matchesSearch && matchesRole;
    });
  }, [activeTeam, memberSearch, roleFilter]);

  // Count unique members across all workspaces.
  const totalMembers = new Set(
    teams.flatMap((team) => team.members.map((member) => member.userId)),
  ).size;

  // Count actual projects across all workspaces.
  const totalProjects = teams.reduce(
    (sum, team) => sum + team.projects,
    0,
  );

  // Create a workspace in Supabase.
  async function handleCreateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanName = teamName.trim();
    const cleanDescription = teamDescription.trim();

    if (!cleanName) {
      setNotice("Please enter a workspace name.");
      return;
    }

    // Prevent duplicate workspace names in the current list.
    const duplicate = teams.some(
      (team) => team.name.toLowerCase() === cleanName.toLowerCase(),
    );

    if (duplicate) {
      setNotice("A workspace with this name already exists.");
      return;
    }

    setCreating(true);

    try {
      // Verify the authenticated user.
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) throw authError;

      if (!user) {
        throw new Error("Please sign in before creating a workspace.");
      }

      // Save the workspace in the database.
      const { data, error } = await supabase
        .from("teams")
        .insert({
          name: cleanName,
          description: cleanDescription || null,
          owner_id: user.id,
        })
        .select("id")
        .single();

      if (error) throw error;

      // The database trigger creates the owner's membership.
      await loadTeams();

      setActiveTeamId(data.id);
      saveActiveWorkspaceId(user.id, data.id);
      setTeamName("");
      setTeamDescription("");
      setWorkspaceSearch("");
      setMemberSearch("");
      setRoleFilter("All roles");
      setShowCreateForm(false);

      setNotice(`"${cleanName}" workspace created successfully.`);
    } catch (error) {
      console.error("Workspace creation failed:", error);

      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to create workspace.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleInviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");

    if (!activeTeam) return;
    if (activeTeam.myRole === "Member") {
      setNotice("Only team owners and admins can invite members.");
      return;
    }

    const cleanEmail = inviteEmail.trim().toLowerCase();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(cleanEmail)) {
      setNotice("Enter a valid email address.");
      return;
    }

    setInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-team-invitation", {
        body: { team_id: activeTeam.id, email: cleanEmail, role: inviteRole },
      });
      if (error) throw error;
      if (!data?.ok || !data.invitation_id) {
        throw new Error("Invitation was not created. Check your email provider configuration.");
      }
      setInviteEmail("");
      setInviteRole("member");
      setShowInviteForm(false);
      setNotice("Invitation email sent to " + cleanEmail + ".");
      await loadTeams();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to send the invitation.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRevokeInvitation(invitationId: string) {
    if (!activeTeam) return;
    setMemberActionKey("invite:" + invitationId);
    setNotice("");
    try {
      const { error } = await supabase.functions.invoke("revoke-team-invitation", {
        body: { team_id: activeTeam.id, invitation_id: invitationId },
      });
      if (error) throw error;
      setNotice("Invitation revoked.");
      await loadTeams();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to revoke the invitation.");
    } finally {
      setMemberActionKey("");
    }
  }

  async function handleMemberAction(userId: string, action: "remove" | "set_role", role?: "admin" | "member") {
    if (!activeTeam) return;
    const actionKey = "member:" + userId;
    setMemberActionKey(actionKey);
    setNotice("");
    try {
      const { error } = await supabase.functions.invoke("manage-team-member", {
        body: { team_id: activeTeam.id, user_id: userId, action, role },
      });
      if (error) throw error;
      setNotice(action === "remove"
        ? "Member removed from the workspace."
        : "Member role updated.");
      await loadTeams();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update this team member.");
    } finally {
      setMemberActionKey("");
    }
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

        {/* Notification */}
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

                <button
                  className="teams-primary-button"
                  type="submit"
                  disabled={creating}
                >
                  <Plus size={17} />
                  {creating ? "Creating..." : "Create workspace"}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Workspace summary */}
        <section className="teams-metrics" aria-label="Workspace summary">
          <article className="teams-metric-card">
            <span className="teams-metric-icon purple">
              <Building2 size={20} />
            </span>

            <div>
              <p>Workspaces</p>
              <strong>{loading ? "—" : teams.length}</strong>
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
              <strong>{loading ? "—" : totalMembers}</strong>
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
              <strong>{loading ? "—" : totalProjects}</strong>
            </div>

            <span className="teams-metric-caption">
              Saved workspace projects
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
                value={workspaceSearch}
                onChange={(event) =>
                  setWorkspaceSearch(event.target.value)
                }
                placeholder="Search workspaces"
              />
            </label>

            <div className="teams-list">
              {loading ? (
                <div className="teams-empty">
                  <span>Loading workspaces...</span>
                </div>
              ) : (
                <>
                  {filteredTeams.map((team) => (
                    <button
                      type="button"
                      key={team.id}
                      className={`teams-list-item ${
                        activeTeamId === team.id ? "selected" : ""
                      }`}
                      onClick={() => {
                        setActiveTeamId(team.id);
                        saveActiveWorkspaceId(currentUserId, team.id);
                        setRoleFilter("All roles");
                        setMemberSearch("");
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

                      <strong>
                        {teams.length === 0
                          ? "No workspaces yet"
                          : "No workspaces found"}
                      </strong>

                      <span>
                        {teams.length === 0
                          ? "Create your first workspace to get started."
                          : "Try another search term."}
                      </span>
                    </div>
                  )}
                </>
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
            {activeTeam ? (
              <>
                <div className="teams-detail-top">
                  <span
                    className={`teams-avatar teams-avatar-${activeTeam.color} teams-avatar-large`}
                  >
                    {activeTeam.initials}
                  </span>

                  <div className="teams-detail-title">
                    <p className="teams-detail-label">
                      WORKSPACE DETAILS
                    </p>

                    <h2>{activeTeam.name}</h2>
                    <p>{activeTeam.description}</p>
                  </div>

                  <span className="teams-role-badge owner" aria-label={"Your role: " + activeTeam.myRole}>
                    <ShieldCheck size={14} />
                    {activeTeam.myRole}
                  </span>
                </div>

                {/* Workspace statistics */}
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
                    <strong>{activeTeam.myRole}</strong>
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

                    <span className="teams-sr-only">
                      Search team members
                    </span>

                    <input
                      value={memberSearch}
                      onChange={(event) =>
                        setMemberSearch(event.target.value)
                      }
                      placeholder="Search members"
                    />
                  </label>

                  <label className="teams-role-filter">
                    <span className="teams-sr-only">
                      Filter by role
                    </span>

                    <select
                      value={roleFilter}
                      onChange={(event) =>
                        setRoleFilter(event.target.value)
                      }
                    >
                      <option>All roles</option>
                      <option>Owner</option>
                      <option>Admin</option>
                      <option>Member</option>
                    </select>
                  </label>
                </div>

                {/* Members table */}
                <div className="teams-table-wrap">
                  <table className="teams-members-table">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Role</th>
                        <th>Access</th>
                        {activeTeam.myRole !== "Member" && <th>Manage</th>}
                      </tr>
                    </thead>

                    <tbody>
                      {filteredMembers.map((member) => (
                        <tr key={member.id}>
                          <td>
                            <div className="teams-member-cell">
                              <span
                                className={`teams-member-avatar ${member.color}`}
                              >
                                {member.initials}
                              </span>

                              <span>
                                <strong>{member.name}</strong>

                                <small>
                                  {member.email ||
                                    "Profile details unavailable"}
                                </small>
                              </span>
                            </div>
                          </td>

                          <td>
                            <span
                              className={`teams-role-badge ${member.role.toLowerCase()}`}
                            >
                              {member.role === "Owner" && (
                                <Crown size={12} />
                              )}

                              {member.role}
                            </span>
                          </td>

                          <td>
                            <span className="teams-access-status">
                              <Check size={14} />
                              Active
                            </span>
                          </td>
                          {activeTeam.myRole !== "Member" && (
                            <td>
                              {member.userId === activeTeam.members.find((item) => item.role === "Owner")?.userId ? (
                                <span className="teams-muted-action">Owner</span>
                              ) : (
                                <div className="teams-row-actions">
                                  {activeTeam.myRole === "Owner" && (
                                    <button
                                      type="button"
                                      className="teams-secondary-button"
                                      disabled={memberActionKey === "member:" + member.userId}
                                      onClick={() => void handleMemberAction(member.userId, "set_role", member.role === "Admin" ? "member" : "admin")}
                                    >
                                      {member.role === "Admin" ? "Make member" : "Make admin"}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="teams-secondary-button"
                                    disabled={memberActionKey === "member:" + member.userId}
                                    onClick={() => void handleMemberAction(member.userId, "remove")}
                                  >
                                    {memberActionKey === "member:" + member.userId ? "Saving…" : "Remove"}
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
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
                    Showing {filteredMembers.length} of{" "}
                    {activeTeam.members.length} members
                  </span>

                  {activeTeam.myRole !== "Member" && (
                    <button
                      type="button"
                      className="teams-invite-button"
                      onClick={() => {
                        setShowInviteForm((value) => !value);
                        setNotice("");
                      }}
                    >
                      <Plus size={16} />
                      Invite members
                    </button>
                  )}
                </div>

                {showInviteForm && activeTeam.myRole !== "Member" && (
                  <section className="teams-create-panel teams-inline-panel" aria-labelledby="invite-member-title">
                    <div className="teams-create-heading">
                      <div>
                        <h3 id="invite-member-title">Invite a team member</h3>
                        <p>An invitation link expires after seven days.</p>
                      </div>
                    </div>
                    <form className="teams-create-form teams-inline-form" onSubmit={handleInviteMember}>
                      <label>
                        Email address
                        <input
                          type="email"
                          autoComplete="email"
                          maxLength={254}
                          required
                          value={inviteEmail}
                          onChange={(event) => setInviteEmail(event.target.value)}
                          placeholder="colleague@example.com"
                        />
                      </label>
                      <label>
                        Role
                        <select
                          value={inviteRole}
                          onChange={(event) => setInviteRole(event.target.value as "admin" | "member")}
                        >
                          <option value="member">Member</option>
                          {activeTeam.myRole === "Owner" && <option value="admin">Admin</option>}
                        </select>
                      </label>
                      <div className="teams-form-actions">
                        <button type="button" className="teams-secondary-button" onClick={() => setShowInviteForm(false)}>
                          Cancel
                        </button>
                        <button type="submit" className="teams-primary-button" disabled={inviting}>
                          {inviting ? "Sending…" : "Send invitation"}
                        </button>
                      </div>
                    </form>
                  </section>
                )}

                {activeTeam.myRole !== "Member" && pendingInvitations.some((invitation) => invitation.teamId === activeTeam.id) && (
                  <section className="teams-invitation-list" aria-label="Pending invitations">
                    <h3>Pending invitations</h3>
                    {pendingInvitations.filter((invitation) => invitation.teamId === activeTeam.id).map((invitation) => (
                      <div className="teams-invitation-row" key={invitation.id}>
                        <div>
                          <strong>{invitation.email}</strong>
                          <small>{invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</small>
                        </div>
                        <button
                          type="button"
                          className="teams-secondary-button"
                          disabled={memberActionKey === "invite:" + invitation.id}
                          onClick={() => void handleRevokeInvitation(invitation.id)}
                        >
                          {memberActionKey === "invite:" + invitation.id ? "Revoking…" : "Revoke"}
                        </button>
                      </div>
                    ))}
                  </section>
                )}
              </>
            ) : (
              <div className="teams-empty">
                <Building2 size={26} />

                <strong>
                  {loading ? "Loading workspace..." : "Select a workspace"}
                </strong>

                <span>
                  {loading
                    ? "Your workspace details will appear here."
                    : "Create a workspace or select one from the list."}
                </span>
              </div>
            )}
          </section>
        </div>

        {/* Page footer */}
        <footer className="teams-footer">
          <ShieldCheck size={16} />
          Workspace data is stored securely in your Supabase database.
        </footer>
      </div>
    </main>
  );
}
