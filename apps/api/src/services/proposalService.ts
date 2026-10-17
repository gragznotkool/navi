import { desc, eq, and, sql } from "drizzle-orm";
import type {
  ApproveProposalRequest,
  ConfigurationProposal,
  GenerateProposalRequest,
  PublishProposalRequest,
  SiteConfiguration,
  UpdateProposalRequest,
} from "@opshub/contracts";
import { recordAudit } from "../audit/audit.js";
import { compileConfiguration } from "../compiler/compile.js";
import type { Database, Tx } from "../db/scoped.js";
import * as s from "../db/schema/index.js";
import { getActiveRelease } from "../repositories/releases.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../utils/errors.js";
import {
  calculateProposalDiff,
  generateProposalPayload,
  hashConfiguration,
} from "./aiProposalEngine.js";

export interface ProposalActor {
  userId: string;
  siteId: string;
  siteSlug: string;
  requestId: string;
  isPlatformAdmin?: boolean;
}

function rowToProposal(
  row: typeof s.configurationProposals.$inferSelect,
  siteSlug: string,
  siteName: string,
  createdByName: string,
  approvedByName?: string | null
): ConfigurationProposal {
  return {
    id: row.id,
    siteId: row.siteId,
    siteSlug,
    siteName,
    title: row.title,
    summary: row.summary,
    prompt: row.prompt,
    status: row.status as any,
    baseVersion: row.baseVersion,
    proposedConfiguration: row.proposedConfiguration as SiteConfiguration,
    configurationHash: row.configurationHash,
    affectedModules: (row.affectedModules as string[]) ?? [],
    changes: (row.changes as any) ?? [],
    diffSummary: (row.diffSummary as any) ?? {},
    validationResult: (row.validationResult as any) ?? { valid: true, errors: [], warnings: [] },
    aiExplanation: (row.aiExplanation as any) ?? {},
    createdBy: row.createdBy,
    createdByName,
    approvedBy: row.approvedBy,
    approvedByName: approvedByName ?? null,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    publishedReleaseVersion: row.publishedReleaseVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ProposalService {
  constructor(private readonly db: Database) {}

  /**
   * Generates a new configuration proposal from natural language prompt.
   */
  async createFromPrompt(
    actor: ProposalActor,
    body: GenerateProposalRequest
  ): Promise<ConfigurationProposal> {
    return this.db.withTenant({ siteId: actor.siteId, userId: actor.userId }, async (tx) => {
      // 1. Fetch site info and active release
      const [site] = await tx
        .select()
        .from(s.sites)
        .where(eq(s.sites.id, actor.siteId))
        .limit(1);
      if (!site) throw notFound("Site not found");

      const [creator] = await tx
        .select({ name: s.users.displayName })
        .from(s.users)
        .where(eq(s.users.id, actor.userId))
        .limit(1);

      const activeRelease = await getActiveRelease(tx, actor.siteId);
      const baseVersion = activeRelease?.version ?? null;
      const currentConfig = (activeRelease?.configuration as SiteConfiguration) ?? {
        siteId: site.id,
        slug: site.slug,
        name: site.name,
        schemaVersion: 2,
        theme: { primary: "#1D4ED8", secondary: "#EA580C" },
        shell: "topbar",
        layouts: [{ id: "data-table", type: "data-table" }],
        modules: {
          nodes: [
            { id: "auth-rbac", moduleType: "auth-rbac", position: { x: 0, y: 0 }, config: {} },
            { id: "dashboard-shell", moduleType: "dashboard-shell", position: { x: 300, y: 0 }, config: {} },
          ],
          edges: [],
        },
        pages: [],
        navigation: [],
        roles: [{ id: "admin", name: "Administrator", description: "Admin", permissions: ["config:manage", "release:publish"] }],
        fields: [],
        customFields: [],
        reports: {},
        calculatedFieldDefinitions: [],
        workflowDefinitions: [],
        metadata: {},
      };

      // 2. Synthesize proposal with AI Engine
      const aiResult = await generateProposalPayload(currentConfig, body.prompt);

      // 3. Compile and validate proposed configuration
      const compileOut = compileConfiguration(aiResult.proposedConfiguration);
      const validationResult = compileOut.result;

      // 4. Calculate diff
      const { diffSummary, changes } = calculateProposalDiff(
        currentConfig,
        aiResult.proposedConfiguration
      );

      const configHash = hashConfiguration(aiResult.proposedConfiguration);

      // 5. Insert proposal row
      const [inserted] = await tx
        .insert(s.configurationProposals)
        .values({
          siteId: actor.siteId,
          title: aiResult.title,
          summary: aiResult.summary,
          prompt: body.prompt,
          status: validationResult.valid ? "validated" : "generated",
          baseVersion,
          proposedConfiguration: aiResult.proposedConfiguration,
          configurationHash: configHash,
          affectedModules: aiResult.proposedConfiguration.modules.nodes.map((n) => n.moduleType),
          changes: changes as any,
          diffSummary: diffSummary as any,
          validationResult: validationResult as any,
          aiExplanation: aiResult.aiExplanation as any,
          createdBy: actor.userId,
        })
        .returning();

      // Audit event
      await recordAudit(tx, {
        siteId: actor.siteId,
        actorId: actor.userId,
        action: "proposal.created",
        entityType: "configuration_proposal",
        entityId: inserted!.id,
        metadata: { title: aiResult.title, prompt: body.prompt, valid: validationResult.valid },
        configVersion: baseVersion ?? undefined,
        requestId: actor.requestId,
      });

      return rowToProposal(
        inserted!,
        site.slug,
        site.name,
        creator?.name ?? "Authorized User"
      );
    });
  }

  /**
   * Lists all proposals for the tenant site.
   */
  async listProposals(actor: ProposalActor): Promise<ConfigurationProposal[]> {
    return this.db.withTenant({ siteId: actor.siteId, userId: actor.userId }, async (tx) => {
      const [site] = await tx
        .select()
        .from(s.sites)
        .where(eq(s.sites.id, actor.siteId))
        .limit(1);

      const rows = await tx
        .select()
        .from(s.configurationProposals)
        .where(eq(s.configurationProposals.siteId, actor.siteId))
        .orderBy(desc(s.configurationProposals.createdAt))
        .limit(50);

      // User lookup for names
      const usersList = await tx.select({ id: s.users.id, name: s.users.displayName }).from(s.users);
      const userMap = new Map(usersList.map((u) => [u.id, u.name]));

      return rows.map((r) =>
        rowToProposal(
          r,
          site?.slug ?? actor.siteSlug,
          site?.name ?? "Site",
          userMap.get(r.createdBy) ?? "Author",
          r.approvedBy ? userMap.get(r.approvedBy) : null
        )
      );
    });
  }

  /**
   * Retrieves an individual proposal by ID with RLS verification.
   */
  async getProposal(actor: ProposalActor, proposalId: string): Promise<ConfigurationProposal> {
    return this.db.withTenant({ siteId: actor.siteId, userId: actor.userId }, async (tx) => {
      const [row] = await tx
        .select()
        .from(s.configurationProposals)
        .where(
          and(
            eq(s.configurationProposals.id, proposalId),
            eq(s.configurationProposals.siteId, actor.siteId)
          )
        )
        .limit(1);

      if (!row) throw notFound("Proposal not found");

      const [site] = await tx
        .select()
        .from(s.sites)
        .where(eq(s.sites.id, actor.siteId))
        .limit(1);

      const usersList = await tx.select({ id: s.users.id, name: s.users.displayName }).from(s.users);
      const userMap = new Map(usersList.map((u) => [u.id, u.name]));

      return rowToProposal(
        row,
        site?.slug ?? actor.siteSlug,
        site?.name ?? "Site",
        userMap.get(row.createdBy) ?? "Author",
        row.approvedBy ? userMap.get(row.approvedBy) : null
      );
    });
  }

  /**
   * Updates or refines a proposal draft.
   */
  async updateProposal(
    actor: ProposalActor,
    proposalId: string,
    body: UpdateProposalRequest
  ): Promise<ConfigurationProposal> {
    return this.db.withTenant({ siteId: actor.siteId, userId: actor.userId }, async (tx) => {
      const [existing] = await tx
        .select()
        .from(s.configurationProposals)
        .where(
          and(
            eq(s.configurationProposals.id, proposalId),
            eq(s.configurationProposals.siteId, actor.siteId)
          )
        )
        .limit(1);

      if (!existing) throw notFound("Proposal not found");
      if (existing.status === "published") {
        throw conflict("proposal_published", "Published proposals cannot be modified");
      }

      let nextConfig = (body.proposedConfiguration ??
        existing.proposedConfiguration) as SiteConfiguration;

      // Handle natural language refinement instruction if provided
      if (body.refinementPrompt) {
        const refined = await generateProposalPayload(nextConfig, body.refinementPrompt);
        nextConfig = refined.proposedConfiguration;
      }

      const compileOut = compileConfiguration(nextConfig);
      const validationResult = compileOut.result;

      const activeRelease = await getActiveRelease(tx, actor.siteId);
      const currentConfig = (activeRelease?.configuration as SiteConfiguration) ?? null;
      const { diffSummary, changes } = calculateProposalDiff(currentConfig, nextConfig);
      const configHash = hashConfiguration(nextConfig);

      const [updated] = await tx
        .update(s.configurationProposals)
        .set({
          title: body.title ?? existing.title,
          proposedConfiguration: nextConfig,
          configurationHash: configHash,
          affectedModules: nextConfig.modules.nodes.map((n) => n.moduleType),
          changes: changes as any,
          diffSummary: diffSummary as any,
          validationResult: validationResult as any,
          status: validationResult.valid ? "validated" : "draft",
          approvedBy: null, // Any edit resets prior approval
          approvedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(s.configurationProposals.id, proposalId))
        .returning();

      return this.getProposal(actor, updated!.id);
    });
  }

  /**
   * Submits proposal for approval.
   */
  async submitForApproval(actor: ProposalActor, proposalId: string): Promise<ConfigurationProposal> {
    return this.db.withTenant({ siteId: actor.siteId, userId: actor.userId }, async (tx) => {
      const [existing] = await tx
        .select()
        .from(s.configurationProposals)
        .where(
          and(
            eq(s.configurationProposals.id, proposalId),
            eq(s.configurationProposals.siteId, actor.siteId)
          )
        )
        .limit(1);

      if (!existing) throw notFound("Proposal not found");
      const validation = existing.validationResult as any;
      if (!validation?.valid) {
        throw badRequest("Cannot submit proposal with validation errors");
      }

      await tx
        .update(s.configurationProposals)
        .set({ status: "pending_approval", updatedAt: new Date() })
        .where(eq(s.configurationProposals.id, proposalId));

      await recordAudit(tx, {
        siteId: actor.siteId,
        actorId: actor.userId,
        action: "proposal.submitted",
        entityType: "configuration_proposal",
        entityId: proposalId,
        metadata: { title: existing.title },
        requestId: actor.requestId,
      });

      return this.getProposal(actor, proposalId);
    });
  }

  /**
   * Approves or rejects a proposal.
   */
  async decideProposal(
    actor: ProposalActor,
    proposalId: string,
    body: ApproveProposalRequest
  ): Promise<ConfigurationProposal> {
    return this.db.withTenant({ siteId: actor.siteId, userId: actor.userId }, async (tx) => {
      const [existing] = await tx
        .select()
        .from(s.configurationProposals)
        .where(
          and(
            eq(s.configurationProposals.id, proposalId),
            eq(s.configurationProposals.siteId, actor.siteId)
          )
        )
        .limit(1);

      if (!existing) throw notFound("Proposal not found");

      if (body.decision === "approve") {
        const validation = existing.validationResult as any;
        if (!validation?.valid) {
          throw badRequest("Cannot approve proposal with failing validation");
        }

        await tx
          .update(s.configurationProposals)
          .set({
            status: "approved",
            approvedBy: actor.userId,
            approvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(s.configurationProposals.id, proposalId));
      } else {
        await tx
          .update(s.configurationProposals)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(eq(s.configurationProposals.id, proposalId));
      }

      await recordAudit(tx, {
        siteId: actor.siteId,
        actorId: actor.userId,
        action: `proposal.${body.decision}d`,
        entityType: "configuration_proposal",
        entityId: proposalId,
        metadata: { decision: body.decision, comment: body.comment },
        requestId: actor.requestId,
      });

      return this.getProposal(actor, proposalId);
    });
  }

  /**
   * Publishes an approved proposal through the existing immutable release pipeline.
   */
  async publishProposal(
    actor: ProposalActor,
    proposalId: string,
    body: PublishProposalRequest
  ): Promise<{ releaseVersion: number; proposal: ConfigurationProposal }> {
    return this.db.withTenant({ siteId: actor.siteId, userId: actor.userId }, async (tx) => {
      // 1. Lock site to serialize releases
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.siteId}))`);

      const [existing] = await tx
        .select()
        .from(s.configurationProposals)
        .where(
          and(
            eq(s.configurationProposals.id, proposalId),
            eq(s.configurationProposals.siteId, actor.siteId)
          )
        )
        .limit(1);

      if (!existing) throw notFound("Proposal not found");
      if (existing.status !== "approved") {
        throw conflict("proposal_unapproved", "Proposal must be approved before publishing");
      }

      // 2. Check stale base version
      const activeRelease = await getActiveRelease(tx, actor.siteId);
      const activeVersion = activeRelease?.version ?? null;

      if (existing.baseVersion !== null && activeVersion !== existing.baseVersion) {
        throw conflict(
          "stale_proposal",
          `Active release changed to v${activeVersion} since proposal creation (base v${existing.baseVersion}). Please revalidate.`
        );
      }

      // 3. Compile & validate again immediately prior to publication
      const compileOut = compileConfiguration(existing.proposedConfiguration);
      if (!compileOut.compiled || !compileOut.result.valid) {
        throw badRequest("Proposed configuration failed compilation check before publication");
      }

      // 4. Create new Release row
      const [nextVRow] = await tx
        .select({ next: sql<number>`coalesce(max(${s.siteReleases.version}), 0) + 1` })
        .from(s.siteReleases)
        .where(eq(s.siteReleases.siteId, actor.siteId));

      const newVersion = nextVRow?.next ?? 1;

      const [release] = await tx
        .insert(s.siteReleases)
        .values({
          siteId: actor.siteId,
          version: newVersion,
          configuration: compileOut.compiled,
          note: `Published via Bolo & Build: ${existing.title}`,
          publishedBy: actor.userId,
        })
        .returning({ id: s.siteReleases.id });

      // 5. Update active release pointer
      await tx
        .insert(s.siteActiveReleases)
        .values({ siteId: actor.siteId, releaseId: release!.id, version: newVersion })
        .onConflictDoUpdate({
          target: s.siteActiveReleases.siteId,
          set: { releaseId: release!.id, version: newVersion, updatedAt: new Date() },
        });

      // 6. Update proposal status
      await tx
        .update(s.configurationProposals)
        .set({
          status: "published",
          publishedReleaseVersion: newVersion,
          updatedAt: new Date(),
        })
        .where(eq(s.configurationProposals.id, proposalId));

      // 7. Record Audit Event
      await recordAudit(tx, {
        siteId: actor.siteId,
        actorId: actor.userId,
        action: "release.published",
        entityType: "site_release",
        entityId: release!.id,
        metadata: {
          version: newVersion,
          proposalId: existing.id,
          prompt: existing.prompt,
        },
        configVersion: newVersion,
        requestId: actor.requestId,
      });

      const updatedProposal = await this.getProposal(actor, proposalId);
      return { releaseVersion: newVersion, proposal: updatedProposal };
    });
  }
}
