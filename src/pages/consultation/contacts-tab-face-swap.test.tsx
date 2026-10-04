import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactsTab } from "./page";

const mocks = vi.hoisted(() => ({
  addContact: vi.fn(),
  onStartFaceSwapCall: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.addContact,
  useQuery: () => [],
  useAction: () => vi.fn(),
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      consultation: {
        tabs: { contacts: "Contacts" },
        faceSwapVideo: "Face Swap Call",
      },
      consultationPage: {
        searchAndAdd: "Search",
        addableUsers: "Users",
        add: "Add",
        noUserMatch: (query: string) => `No user ${query}`,
        noContacts: "No contacts",
        addContactsHint: "Add contacts",
        voiceCall: "Voice call",
        videoCall: "Video call",
        sendMessage: "Message",
        removeContact: "Remove",
        contactAdded: (name: string) => `Added ${name}`,
        genericError: "Error",
      },
    },
  }),
}));

const contact = {
  _id: "contact-1",
  targetCode: "BBBBB",
  targetName: "Callee",
  targetDepartment: "Support",
};

function renderContacts(canStartFaceSwapCall: boolean) {
  return render(
    <ContactsTab
      userCode="AAAAA"
      userName="Caller"
      contacts={[contact]}
      onStartCall={() => undefined}
      canStartFaceSwapCall={canStartFaceSwapCall}
      onStartFaceSwapCall={mocks.onStartFaceSwapCall}
      callingCode={null}
      onRemoveContact={async () => undefined}
      navigate={() => undefined}
    />,
  );
}

describe("ContactsTab face-swap call entry", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => "device-a" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not expose face-swap calling to a non-full-feature user", () => {
    renderContacts(false);
    expect(
      screen.queryByRole("button", { name: "Face Swap Call" }),
    ).not.toBeInTheDocument();
  });

  it("starts a face-swap call for the selected contact when fully enabled", () => {
    renderContacts(true);

    fireEvent.click(screen.getByRole("button", { name: "Face Swap Call" }));

    expect(mocks.onStartFaceSwapCall).toHaveBeenCalledWith("BBBBB", "Callee");
  });
});
