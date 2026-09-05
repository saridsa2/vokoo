"use client";

/**
 * Enrolments, with a way to put a patient on a path.
 *
 * Three fields, and the third is the one that matters. `started_on` is day 0 of
 * *this patient's* path: every contact the path asks for is counted from it, so
 * two patients enrolled a week apart are never at the same point. A cohort-wide
 * start date would make the whole thing one campaign, which is what this is
 * deliberately not.
 *
 * It defaults to today and is editable, because enrolling somebody a fortnight
 * after their cycle began is the ordinary case — a hospital adopting this has a
 * ward full of patients already mid-path.
 */

import { useMemo, useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { ResourceListScreen } from "@/components/application/screens/resource-list-screen";
import { api } from "@/utils/api-client";
import { useNotify } from "@/components/application/notifications/notification-provider";
import { useResource } from "@/hooks/use-resource";
import { useSession } from "@/hooks/use-session";

type PatientRow = { id: string; full_name?: string; phone?: string };
type CohortRow = { id: string; name?: string; flows?: { name?: string } | null };

/** Today, as the database wants it. Local, so "today" means the reader's. */
function todayISO(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const EnrolmentsScreen = () => {
    const [open, setOpen] = useState(false);
    /* Bumped when a row is created, so the list re-reads. The dialog and the
       list hold separate `useResource` instances and neither can patch the
       other's state. */
    const [created, setCreated] = useState(0);

    return (
        <>
            <ResourceListScreen
                resourceKey="enrolments"
                reloadToken={created}
                createSlot={
                    <Button size="sm" onClick={() => setOpen(true)}>
                        Enrol Patient
                    </Button>
                }
            />
            <EnrolDialog
                isOpen={open}
                onClose={() => setOpen(false)}
                onCreated={() => setCreated((n) => n + 1)}
            />
        </>
    );
};

const EnrolDialog = ({
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
    const { records: patients, isLoading: loadingPatients } = useResource<PatientRow>("patients");
    const { records: cohorts, isLoading: loadingCohorts } = useResource<CohortRow>("cohorts");

    const [patientId, setPatientId] = useState<string | null>(null);
    const [cohortId, setCohortId] = useState<string | null>(null);
    const [startedOn, setStartedOn] = useState(todayISO());
    const [saving, setSaving] = useState(false);
    /** Only the already-enrolled refusal. Everything else is a notification. */
    const [already, setAlready] = useState(false);

    const patientOptions = useMemo(
        () =>
            (patients ?? []).map((patient) => ({
                id: patient.id,
                // The number disambiguates two people with one name, which a
                // ward of forty will have.
                label: [patient.full_name || "Unnamed", patient.phone].filter(Boolean).join(" · "),
            })),
        [patients],
    );

    const cohortOptions = useMemo(
        () =>
            (cohorts ?? []).map((cohort) => ({
                id: cohort.id,
                // The path, because two cohorts can be named for the same ward
                // and it is the path that decides what the patient is asked.
                label: [cohort.name || "Untitled", cohort.flows?.name].filter(Boolean).join(" · "),
            })),
        [cohorts],
    );

    const usable = Boolean(patientId && cohortId && /^\d{4}-\d{2}-\d{2}$/.test(startedOn));

    const enrol = async () => {
        if (!context || !usable) return;
        setSaving(true);
        setAlready(false);
        try {
            await api.create(
                "enrolments",
                { patient_id: patientId, cohort_id: cohortId, started_on: startedOn, status: "active" },
                context,
            );
            onClose();
            setPatientId(null);
            setCohortId(null);
            setStartedOn(todayISO());
            notify.success("Patient enrolled");
            onCreated();
        } catch (problem) {
            const message = (problem as Error).message;
            if (/duplicate|unique/i.test(message)) setAlready(true);
            else notify.failure("Could not enrol the patient", problem);
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
                            <h2 className="text-lg font-semibold text-primary">Enrol a patient</h2>
                            <p className="text-sm text-tertiary">
                                Puts one patient on one care path, from a date. They can be on several.
                            </p>
                        </div>

                        <Select
                            label="Patient"
                            placeholder={loadingPatients ? "Loading…" : "Who is being followed"}
                            selectedKey={patientId}
                            onSelectionChange={(key) => {
                                setPatientId(key ? String(key) : null);
                                setAlready(false);
                            }}
                            items={patientOptions}
                            isRequired
                            isDisabled={loadingPatients}
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>

                        <Select
                            label="Cohort"
                            placeholder={loadingCohorts ? "Loading…" : "Which care path"}
                            selectedKey={cohortId}
                            onSelectionChange={(key) => {
                                setCohortId(key ? String(key) : null);
                                setAlready(false);
                            }}
                            items={cohortOptions}
                            isRequired
                            isDisabled={loadingCohorts}
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>

                        <Input
                            label="Path begins"
                            type="date"
                            value={startedOn}
                            onChange={(value) => setStartedOn(String(value))}
                            isRequired
                            hint="Day 0 for this patient. Backdate it if their path already started — every contact is counted from here."
                        />

                        {already ? (
                            <p className="text-sm text-error-primary">
                                That patient is already on this cohort. To restart their path, withdraw the
                                existing enrolment first.
                            </p>
                        ) : null}

                        {!loadingCohorts && cohortOptions.length === 0 ? (
                            <p className="text-sm text-tertiary">
                                There are no cohorts yet. Create one first — it is the care path a patient is
                                enrolled on.
                            </p>
                        ) : null}

                        <div className="flex justify-end gap-3">
                            <Button color="secondary" size="sm" onClick={onClose} isDisabled={saving}>
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={enrol}
                                isDisabled={!usable || saving}
                                isLoading={saving}
                                showTextWhileLoading
                            >
                                {saving ? "Enrolling…" : "Enrol"}
                            </Button>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
};
