import type { LinearDocument } from "@linear/sdk";
import type {
  IssueTracker,
  ReportFile,
  ReportAttachments,
  SubmittedReportMetadata,
} from "../application/submit-report";
import type { ReportReceipt } from "../../src/reporting/report";
import { presentReport } from "./report-markdown";

interface Destination {
  teamId: string;
  projectId: string;
  labelId: string;
  stateId: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Linear response.");
  return value as Record<string, unknown>;
}

function httpsUrl(value: unknown): string {
  if (typeof value !== "string" || new URL(value).protocol !== "https:")
    throw new Error("Invalid Linear asset URL.");
  return value;
}

function receipt(value: unknown): ReportReceipt {
  const issue = record(value);
  if (typeof issue.identifier !== "string" || !issue.identifier)
    throw new Error("Invalid Linear issue identifier.");
  const url = httpsUrl(issue.url);
  if (new URL(url).origin !== "https://linear.app")
    throw new Error("Invalid Linear issue URL.");
  return { identifier: issue.identifier, url };
}

export class LinearIssueTracker implements IssueTracker {
  constructor(
    private readonly apiKey: string,
    private readonly destination: Destination,
    private readonly request: typeof fetch = fetch.bind(globalThis),
  ) {}

  private async graphql(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.request("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10000),
      redirect: "manual",
    });
    if (!response.ok)
      throw new Error(`Linear API returned ${response.status}.`);
    const body = record(await response.json());
    if (body.errors !== undefined)
      throw new Error("Linear rejected the report operation.");
    return record(body.data);
  }

  async findReport(id: string): Promise<ReportReceipt | null> {
    // Filter query returns an empty connection for a new client-generated UUID.
    const filter: LinearDocument.IssueFilter = {
      id: { eq: id },
      project: { id: { eq: this.destination.projectId } },
      team: { id: { eq: this.destination.teamId } },
    };
    const data = await this.graphql(
      "query Report($filter: IssueFilter!) { issues(filter: $filter, first: 1) { nodes { identifier url } } }",
      { filter },
    );
    const nodes = record(data.issues).nodes;
    if (!Array.isArray(nodes) || nodes.length > 1)
      throw new Error("Invalid Linear issue lookup.");
    return nodes.length ? receipt(nodes[0]) : null;
  }

  async upload(file: ReportFile): Promise<string> {
    const data = await this.graphql(
      "mutation Upload($contentType: String!, $filename: String!, $size: Int!) { fileUpload(contentType: $contentType, filename: $filename, size: $size) { success uploadFile { uploadUrl assetUrl headers { key value } } } }",
      {
        contentType: file.contentType,
        filename: file.name,
        size: file.bytes.byteLength,
      },
    );
    const result = record(data.fileUpload);
    if (result.success !== true)
      throw new Error("Linear did not accept the attachment.");
    const fileUpload = record(result.uploadFile);
    const uploadUrl = httpsUrl(fileUpload.uploadUrl);
    const assetUrl = httpsUrl(fileUpload.assetUrl);
    if (!Array.isArray(fileUpload.headers))
      throw new Error("Invalid Linear upload headers.");
    const headers = new Headers({
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=31536000",
    });
    for (const entry of fileUpload.headers) {
      const header = record(entry);
      if (typeof header.key !== "string" || typeof header.value !== "string")
        throw new Error("Invalid Linear upload header.");
      headers.set(header.key, header.value);
    }
    const response = await this.request(uploadUrl, {
      method: "PUT",
      headers,
      body: new Blob([new Uint8Array(file.bytes)]),
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
    if (!response.ok)
      throw new Error(`Linear attachment upload returned ${response.status}.`);
    return assetUrl;
  }

  async createReport(
    report: SubmittedReportMetadata,
    attachments: ReportAttachments,
  ): Promise<ReportReceipt> {
    const input: LinearDocument.IssueCreateInput = {
      id: report.id,
      ...presentReport(report, attachments),
      teamId: this.destination.teamId,
      projectId: this.destination.projectId,
      labelIds: [this.destination.labelId],
      stateId: this.destination.stateId,
    };
    try {
      const data = await this.graphql(
        "mutation Report($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }",
        { input },
      );
      const result = record(data.issueCreate);
      if (result.success !== true)
        throw new Error("Linear did not create the report.");
      return receipt(result.issue);
    } catch (error) {
      // A concurrent/retried request may already have created this exact UUID.
      const existing = await this.findReport(report.id);
      if (existing) return existing;
      throw error;
    }
  }
}
