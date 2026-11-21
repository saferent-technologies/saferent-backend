import { describe, expect, it } from "vitest";
import { ID_TYPE_KEY, tutorialFileProblem, tutorialTitleProblem, tutorialUrlProblem } from "../src/lib/kycTutorials";

const mp4Head = Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

describe("owner verification guides", () => {
  it("accepts direct https file links of the right type", () => {
    expect(tutorialUrlProblem("VIDEO", "https://cdn.saferenttechnologies.com/guides/aadhaar.mp4")).toBeNull();
    expect(tutorialUrlProblem("PDF", "https://firebasestorage.googleapis.com/v0/b/x.appspot.com/o/guides%2Fsteps.pdf?alt=media&token=abc")).toBeNull();
    expect(tutorialUrlProblem("IMAGE", "https://cdn.example.com/a.webp")).toBeNull();
  });

  it("rejects http, share pages and the wrong file type", () => {
    expect(tutorialUrlProblem("VIDEO", "http://cdn.example.com/a.mp4")).toMatch(/https/);
    expect(tutorialUrlProblem("VIDEO", "https://www.youtube.com/watch?v=abc")).toMatch(/direct file/);
    expect(tutorialUrlProblem("PDF", "https://drive.google.com/file/d/abc/view")).toMatch(/direct file/);
    expect(tutorialUrlProblem("PDF", "https://cdn.example.com/a.mp4")).toMatch(/\.pdf/);
    expect(tutorialUrlProblem("IMAGE", "not a link")).toMatch(/valid link/);
  });

  it("checks uploaded files by magic bytes, codec and size", () => {
    expect(tutorialFileProblem("VIDEO", mp4Head, 1000, null, true)).toBeNull();
    expect(tutorialFileProblem("VIDEO", mp4Head, 1000, null, false)).toMatch(/H\.264/);
    expect(tutorialFileProblem("VIDEO", Buffer.from("%PDF-1.7"), 1000, null, true)).toMatch(/MP4/);
    expect(tutorialFileProblem("VIDEO", mp4Head, 51 * 1024 * 1024, null, true)).toMatch(/50 MB/);
    expect(tutorialFileProblem("PDF", Buffer.from("%PDF-1.7"), 1000, null)).toBeNull();
    expect(tutorialFileProblem("PDF", Buffer.from("PK\x03\x04"), 1000, null)).toMatch(/PDF/);
    expect(tutorialFileProblem("PDF", Buffer.from("%PDF-1.7"), 31 * 1024 * 1024, null)).toMatch(/30 MB/);
    expect(tutorialFileProblem("IMAGE", Buffer.alloc(4), 1000, "image/png")).toBeNull();
    expect(tutorialFileProblem("IMAGE", Buffer.alloc(4), 1000, null)).toMatch(/JPG/);
    expect(tutorialFileProblem("IMAGE", Buffer.alloc(4), 6 * 1024 * 1024, "image/jpeg")).toMatch(/5 MB/);
  });

  it("checks titles and ID type keys", () => {
    expect(tutorialTitleProblem("Aadhaar offline eKYC")).toBeNull();
    expect(tutorialTitleProblem("e-Aadhaar PDF")).toBeNull(); // a hyphen inside a word is fine
    expect(tutorialTitleProblem("Aadhaar \u2014 steps")).toMatch(/dashes/);
    expect(tutorialTitleProblem("Aadhaar - steps")).toMatch(/dashes/);
    expect(tutorialTitleProblem("x".repeat(61))).toMatch(/60/);
    expect(tutorialTitleProblem(" ")).toMatch(/title/);
    expect(ID_TYPE_KEY.test("AADHAAR_XML")).toBe(true);
    expect(ID_TYPE_KEY.test("VOTER_ID")).toBe(true);
    expect(ID_TYPE_KEY.test("voter id")).toBe(false);
  });
});
