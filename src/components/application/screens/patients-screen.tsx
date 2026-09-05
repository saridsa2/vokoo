"use client";

/**
 * The patient list, with a way to add one.
 *
 * A patient is identity and nothing else — name, number, language, the
 * hospital's own record number. Which care paths they are on lives in an
 * enrolment, because somebody can be on a GLP-1 path and postpartum at the same
 * time and both are true of the same person.
 *
 * So this dialog asks for four fields and stops. Asking "and which cohort?"
 * here would make the common case wrong: a patient added today may be enrolled
 * next week, or on three paths at once, and neither fits a single picker.
 */

import { useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { ResourceListScreen } from "@/components/application/screens/resource-list-screen";
import { api } from "@/utils/api-client";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useSession } from "@/hooks/use-session";
import { keepPhone, PHONE_INPUT } from "@/utils/numeric-input";

/**
 * What the engines can be told to work in.
 *
 * Both Sarvam services take their language when the socket opens, so this is
 * decided before a call rather than guessed from an accent — which is why it is
 * a field on the patient and not something inferred later.
 */
const LANGUAGES = [
    { id: "hi-IN", label: "Hindi" },
    { id: "en-IN", label: "English (India)" },
    { id: "bn-IN", label: "Bengali" },
    { id: "gu-IN", label: "Gujarati" },
    { id: "kn-IN", label: "Kannada" },
    { id: "ml-IN", label: "Malayalam" },
    { id: "mr-IN", label: "Marathi" },
    { id: "od-IN", label: "Odia" },
    { id: "pa-IN", label: "Punjabi" },
    { id: "ta-IN", label: "Tamil" },
    { id: "te-IN", label: "Telugu" },
];

export const PatientsScreen = () => {
    const [open, setOpen] = useState(false);
    /* Bumped when a row is created, so the list re-reads. The dialog and the
       list hold separate `useResource` instances and neither can patch the
       other's state. */
    const [created, setCreated] = useState(0);

    return (
        <>
            <ResourceListScreen
                resourceKey="patients"
                reloadToken={created}
                createSlot={
                    <Button size="sm" onClick={() => setOpen(true)}>
                        Add Patient
                    </Button>
                }
            />
            <AddPatientDialog
                isOpen={open}
                onClose={() => setOpen(false)}
                onCreated={() => setCreated((n) => n + 1)}
            />
        </>
    );
};

const AddPatientDialog = ({
    isOpen,
    onClose,
    onCreated,
}: {
    isOpen: boolean;
    onClose: () => void;
    onCreated: () => void;
}) => {
    const { context } = useSession();
    const notify = useNotify();

    const [name, setName] = useState("");
    const [phone, setPhone] = useState("+91");
    const [language, setLanguage] = useState<string | null>("hi-IN");
    const [mrn, setMrn] = useState("");
    const [saving, setSaving] = useState(false);
    /** Only the already-on-file refusal, because it is about the field above it. */
    const [duplicate, setDuplicate] = useState(false);

    const reset = () => {
        setName("");
        setPhone("+91");
        setLanguage("hi-IN");
        setMrn("");
        setDuplicate(false);
    };

    // A number the carrier can dial. `+` and at least ten digits — short of
    // that it is a half-typed number rather than a bad one, so the button is
    // simply not ready.
    const usable = name.trim().length > 0 && /^\+\d{10,15}$/.test(phone);

    const create = async () => {
        if (!context || !usable) return;
        setSaving(true);
        setDuplicate(false);
        try {
            await api.create(
                "patients",
                {
                    full_name: name.trim(),
                    phone: phone.trim(),
                    language,
                    // Empty means "not recorded" rather than an empty string,
                    // so a later write-back can tell the difference.
                    mrn: mrn.trim() || null,
                },
                context,
            );
            onClose();
            reset();
            notify.success("Patient added");
            onCreated();
        } catch (problem) {
            if (/duplicate|unique/i.test((problem as Error).message)) setDuplicate(true);
            else notify.failure("Could not add the patient", problem);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalOverlay isOpen={isOpen} onOpenChange={(next) => !next && onClose()} isDismissable={!saving}>
            <Modal className="max-w-md">
                <Dialog>
                    <div className="flex w-full flex-col gap-5 rounded-xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                        <div className="flex flex-col gap-1">
                            <h2 className="text-lg font-semibold text-primary">Add patient</h2>
                            <p className="text-sm text-tertiary">
                                A person, not an enrolment. You put them on a care path separately, and they
                                can be on more than one.
                            </p>
                        </div>

                        <Input
                            label="Full name"
                            placeholder="Sunita Mehta"
                            value={name}
                            onChange={(value) => setName(String(value))}
                            isRequired
                            autoFocus
                        />

                        <Input
                            label="Phone"
                            placeholder="+919949879837"
                            value={phone}
                            // Digits and one leading `+`. Typing a letter into a
                            // phone field should do nothing rather than be
                            // accepted and rejected on submit.
                            onChange={(value) => {
                                setPhone(keepPhone(String(value)));
                                setDuplicate(false);
                            }}
                            {...PHONE_INPUT}
                            isRequired
                            isInvalid={duplicate}
                            hint="With the country code, as the carrier dials it."
                        />

                        {duplicate ? (
                            <p className="text-sm text-error-primary">
                                Somebody with that number is already on file. Find them in the list rather than
                                adding a second record.
                            </p>
                        ) : null}

                        <Select
                            label="Language"
                            selectedKey={language}
                            onSelectionChange={(key) => setLanguage(key ? String(key) : null)}
                            items={LANGUAGES}
                            hint="Settled before the call starts, so the ear and the voice agree."
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>

                        <Input
                            label="MRN"
                            placeholder="Optional"
                            value={mrn}
                            onChange={(value) => setMrn(String(value))}
                            hint="Your own record number. What an outcome written back to your systems is matched on."
                        />

                        <div className="flex justify-end gap-3">
                            <Button color="secondary" size="sm" onClick={onClose} isDisabled={saving}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={create}
                                isDisabled={!usable || saving}
                                isLoading={saving}
                                showTextWhileLoading
                            >
                                {saving ? "Adding…" : "Add patient"}
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
};
