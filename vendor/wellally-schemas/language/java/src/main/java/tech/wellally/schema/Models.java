package tech.wellally.schema;

import java.util.List;
import java.util.Objects;

/**
 * WellAll schemas v0.1.0 aligned with https://www.wellally.tech/
 */
public final class Models {

    // ---------- Common ----------
    public record Coding(String system, String code, String display) {}

    public record CodeableConcept(List<Coding> coding, String text) {}

    public record Quantity(double value, String unit) {}

    public record ReferenceRange(Quantity low, Quantity high, String text) {}

    public record Identifier(String system, String value, CodeableConcept type,
                             Period period) {}

    public record HumanName(String family, List<String> given, String use,
                            List<String> prefix, List<String> suffix) {}

    public record ContactPoint(String system, String value, String use) {}

    public record Address(List<String> line, String city, String state,
                          String postalCode, String country) {}

    public record Period(String start, String end) {}

    public record Modality(String system, String code, String display) {}

    public record Route(String system, String code, String display) {}

    public record SpecimenType(String system, String code, String display) {}

    // ---------- Health Person ----------
    public record ClinicalSummary(List<CodeableConcept> conditions,
                                  List<CodeableConcept> allergies,
                                  String bloodType,
                                  String primaryCareProvider) {}

    public record HealthPerson(String id,
                               List<HumanName> name,
                               String birthDate,
                               String resourceType,
                               List<Identifier> identifier,
                               String gender,
                               List<ContactPoint> telecom,
                               List<Address> address,
                               CodeableConcept maritalStatus,
                               List<String> language,
                               ClinicalSummary clinicalSummary) {
        public HealthPerson {
            if (resourceType == null || resourceType.isBlank()) resourceType = "Person";
        }
    }

    // ---------- Lab Report ----------
    public sealed interface LabResultValue permits LabResultValue.QuantityValue, LabResultValue.CodeableConceptValue, LabResultValue.TextValue {
        record QuantityValue(Quantity value) implements LabResultValue {}
        record CodeableConceptValue(CodeableConcept value) implements LabResultValue {}
        record TextValue(String value) implements LabResultValue {}
    }

    public record LabResult(CodeableConcept code,
                            LabResultValue value,
                            ReferenceRange referenceRange,
                            String interpretation,
                            CodeableConcept method) {}

    public record Specimen(SpecimenType type, String collectedAt) {}

    public record Facility(String id, String name) {}

    public record LabReport(String id,
                            String patientId,
                            String issuedAt,
                            List<LabResult> results,
                            Facility facility,
                            CodeableConcept panel,
                            Specimen specimen) {}

    // ---------- Imaging Report ----------
    public record Attachment(String url, String type) {}

    public record RadiationDose(Double ctdiVol_mGy, Double dlp_mGy_cm) {}

    public record Performer(String id, String name, String role) {}

    public record ImagingReport(String id,
                                String patientId,
                                Modality modality,
                                Coding bodySite,
                                String reportedAt,
                                String studyInstanceUid,
                                Performer performer,
                                List<String> findings,
                                String impression,
                                RadiationDose radiationDose,
                                List<Attachment> attachments) {}

    // ---------- Medication ----------
    public record Dosage(double value, String unit) {}

    public record MedicationRecord(String id,
                                    String patientId,
                                    Coding medication,
                                    Dosage dosage,
                                    Route route,
                                    String startDate,
                                    Coding form,
                                    String frequency,
                                    Integer durationDays,
                                    String endDate,
                                    CodeableConcept indication,
                                    String instructions) {}

    // ---------- Family Health ----------
    public record FamilyMember(String id,
                               String relationToProband,
                               String sex,
                               Integer birthYear,
                               Boolean deceased,
                               List<CodeableConcept> conditions) {}

    public record FamilyHealthTree(String probandId, List<FamilyMember> members) {}
}
