# What a heart–lung transplant follow-up actually collects

Written 9 September 2026, because the patient app needed numbers and inventing
them was the one thing it must not do. KIMS Secunderabad is a heart and lung
transplant centre; there is no HLT care path on the backend yet, so this is the
source the mock rests on and the shape the real one should take.

Everything below is cited. Where a figure is a threshold that changes clinical
action, the citation is the primary one, not a summary of it.

## The one measurement the whole follow-up turns on

**FEV1**, from a spirometer the patient blows into at home.

It is not a wellness number. A fall in FEV1 is how rejection and infection
announce themselves in a transplanted lung, usually before the patient feels
anything, and the entire monitoring apparatus exists to catch that fall early.

| | |
|---|---|
| **Baseline** | the average of **two maximal post-transplant FEV1 values taken at least three weeks apart** ([ISHLT CLAD consensus, Verleden et al. 2019](https://doi.org/10.1016/j.healun.2019.03.009)) |
| **Act on** | a **10% decline persisting more than 2 days** — reported to indicate either rejection or infection ([Morlion et al. 2002](https://doi.org/10.1164/ajrccm.165.5.2107059)) |
| **CLAD** | a **≥20% decline from baseline persisting more than 3 months**, with no other identifiable cause |
| **In clinic** | spirometry **monthly for the first post-transplant year**, then **every 3–4 months** |
| **At home** | **at least weekly** in the trial that tested this exact product shape |

Two consequences for us, and they are design decisions rather than clinical ones:

- **The baseline is a stored value with provenance, not a computed average of
  whatever is on file.** It is set by the unit from two named tests, it can be
  legitimately *reset* (aging, weight gain, surgery — but only after 6 months of
  stability), and it must never be reset for the things that look like decline
  because they *are* decline: rejection, infection, recurrence, drug toxicity.
  A schema that recomputes a baseline from recent readings would erase the very
  drop it exists to detect.
- **The alert rule is a persistence rule, not a threshold.** One low blow is a
  bad blow — a patient who did not seal their lips. Two days is the unit of the
  rule, which means the app has to keep a series and not just a latest value.

## What the home-monitoring trial actually asked for

[Evaluation of a Home Monitoring Application for Follow Up after Lung
Transplantation — a pilot study](https://pmc.ncbi.nlm.nih.gov/articles/PMC7711442/)
is the closest published thing to what we are building, and the useful part is
where it fell short.

Collected: **FEV1 and FVC** by Bluetooth spirometer, at least weekly. Adherence
to the weekly measurement was **100%**, over a median follow-up of **93 days**;
80% were measuring daily.

Not collected, and asked for by the patients: **blood pressure, oxygen
saturation, heart rate, glucose, weight, temperature**, and **physical
symptoms** — 80% wanted to report symptoms.

**Automated alerts for lung function decline had not been implemented.** The
data were read by researchers twice a week, and patients were told to ring the
hospital themselves if their numbers fell. That is the gap this product is for,
and it is worth stating plainly: the clinical thresholds are published, the
adherence is achievable, and what was missing was somebody watching between the
readings.

## The heart half

Combined heart–lung recipients, and heart recipients, carry a second surveillance
track that is procedural rather than measured at home.

- **Endomyocardial biopsy**, at intervals of roughly: weekly for the first 4
  weeks, twice monthly in months 2–3, monthly for the next 3 months, then
  3-monthly to the end of the first year. Each is graded for acute cellular and
  antibody-mediated rejection against ISHLT criteria.
- **Tacrolimus trough**, targeted at **9–12 ng/mL for the first 3 months** and
  **8–9 ng/mL between 3 and 6 months**. It is the *variability* that predicts
  rejection, not any single reading — high trough variability is associated with
  rejection after heart transplant, which means the app should show the series
  and its band, never one number.

Sources: [tacrolimus levels and biopsy-proven acute cellular rejection](https://pmc.ncbi.nlm.nih.gov/articles/PMC12444152/),
[trough variability and rejection](https://www.amjtransplant.org/article/S1600-6135(22)09742-8/fulltext).

## So the data model is four kinds of thing

| kind | examples | who enters it | cadence |
|---|---|---|---|
| **home measurement** | FEV1, FVC, weight, temperature, BP, HR, SpO2 | the patient, from a device or by hand | daily to weekly |
| **symptom answer** | breathlessness, cough, sputum colour, swelling, fever | the patient, from a short question set | weekly, or when asked |
| **lab result** | tacrolimus trough, creatinine, FBC, LFT, glucose, CMV PCR | a lab, arriving as a document the patient photographs | at the schedule the unit sets |
| **procedure** | biopsy, bronchoscopy, echo, clinic spirometry | the hospital | by milestone |

Only the first two are things this app asks a patient for. The third arrives as
a document — which is why Reports exists and why an outreach request for a blood
test resolves by photograph. The fourth is a date on the programme, not a task.

**What has no source yet, and must not be invented:** the schedule KIMS itself
runs, its own tacrolimus targets, and which symptom questions its coordinators
ask. Every figure above is from the literature and belongs in a care path only
after the unit has said it is theirs.

## Where the mock came from

`patient-app/app/services/mock/careData.ts` carries a series shaped by the rules
above — a baseline set from two tests three weeks apart, daily readings around
it, one dip that recovers, and troughs inside the 9–12 band. The values
themselves are synthetic and labelled as such in that file. They are calibrated
for plausibility against the FEV1 distribution in
[AWARE](https://huggingface.co/datasets/ericyxy98/pulmonary-disease-airway-lung-function-dataset)
(median 2.66 L overall; 1.84–2.67 L interquartile for women aged 45–60 at
155–168 cm) — read for scale only, never copied, since that dataset is
CC-BY-NC-SA and this is not a share-alike codebase.

**Hugging Face has nothing for this.** Searched: spirometry, lung transplant,
transplant, FEV1, pulmonary function, tacrolimus, SRTR, UNOS, home monitoring,
patient reported outcomes, longitudinal clinical, immunosuppression. The only
real lung-function data is that asthma cohort. Transplant follow-up series live
in registries that need an application, not on a model hub — worth knowing
before anyone searches again.

## To fix later: the questionnaire should be triggered, not scheduled

Recorded 10 September, not built.

The weekly symptom questionnaire is currently a **fixed weekly outreach** — it
goes out every week whether or not anything has changed. That is the wrong
shape. It should fire on one of two things:

- **A signal in the patient's own data.** Sleep falling away, resting heart rate
  drifting up, a wobble in the morning readings. The passive series already
  arriving from the watch are exactly the right input.
- **A backend flow trigger**, the same machinery the care path already uses for
  everything else.

**Why this is better than a weekly ping.** A questionnaire that arrives every
Tuesday regardless is noise, and noise is what patients learn to dismiss — by
month four it is answered without being read. One that arrives *because
something moved* carries information in the fact of its arrival.

**And it resolves the tension in how passive data is shown.** The app shows
sleep and resting heart rate with no thresholds and no action line, because no
published transplant guidance tells a patient what to do about a bad night's
sleep — see the note in `patient-app/app/services/mock/careData.ts`. But the
*care path* may absolutely use those series to decide when to ask a question.
That is not the app telling a patient their sleep is poor; it is the system
noticing and asking how they have been. The patient is never shown a threshold
that does not exist, and the signal is still used.

What it needs: a trigger that can watch an observation series, which is a
`trigger.*` node the catalogue does not have yet, plus somewhere for the
thresholds to live that is not the app.
