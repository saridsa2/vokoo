package tech.wellally.health.labreport;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import tech.wellally.health.common.Common.*;

import java.time.Instant;
import java.util.List;

/**
 * Lab Report data models.
 *
 * Package: tech.wellally.health
 * Website: https://www.wellally.tech/
 * Schema: https://wellall.health/schemas/lab-report/v0.1.0
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class LabReportModels {

    /**
     * Lab result interpretation
     */
    public enum Interpretation {
        /** Normal */
        @JsonProperty("N") N,
        /** Low */
        @JsonProperty("L") L,
        /** High */
        @JsonProperty("H") H,
        /** Abnormal */
        @JsonProperty("A") A
    }

    /**
     * Lab facility information.
     */
    public static class Facility {
        private String id;
        private String name;

        public Facility() {}

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
    }

    /**
     * Specimen information.
     */
    public static class Specimen {
        private Coding type;
        private Instant collectedAt;

        public Specimen() {}

        public Coding getType() { return type; }
        public void setType(Coding type) { this.type = type; }

        public Instant getCollectedAt() { return collectedAt; }
        public void setCollectedAt(Instant collectedAt) { this.collectedAt = collectedAt; }
    }

    /**
     * Individual lab test result.
     */
    public static class LabResult {
        /**
         * LOINC code for the test
         */
        private CodeableConcept code;

        /**
         * Result value (Quantity, CodeableConcept, or String)
         */
        private Object value;

        /**
         * Normal reference range
         */
        private ReferenceRange referenceRange;

        /**
         * N (normal), L (low), H (high), A (abnormal)
         */
        private Interpretation interpretation;

        /**
         * Test method used
         */
        private CodeableConcept method;

        public LabResult() {}

        public CodeableConcept getCode() { return code; }
        public void setCode(CodeableConcept code) { this.code = code; }

        public Object getValue() { return value; }
        public void setValue(Object value) { this.value = value; }

        public ReferenceRange getReferenceRange() { return referenceRange; }
        public void setReferenceRange(ReferenceRange referenceRange) { this.referenceRange = referenceRange; }

        public Interpretation getInterpretation() { return interpretation; }
        public void setInterpretation(Interpretation interpretation) { this.interpretation = interpretation; }

        public CodeableConcept getMethod() { return method; }
        public void setMethod(CodeableConcept method) { this.method = method; }
    }

    /**
     * Laboratory test report.
     */
    public static class LabReport {
        /**
         * Unique report identifier
         */
        private String id;

        /**
         * Reference to Person.id
         */
        private String patientId;

        /**
         * Report issue timestamp
         */
        private Instant issuedAt;

        /**
         * List of lab test results
         */
        private List<LabResult> results;

        /**
         * Lab facility information
         */
        private Facility facility;

        /**
         * Test panel code
         */
        private CodeableConcept panel;

        /**
         * Specimen information
         */
        private Specimen specimen;

        public LabReport() {}

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }

        public String getPatientId() { return patientId; }
        public void setPatientId(String patientId) { this.patientId = patientId; }

        public Instant getIssuedAt() { return issuedAt; }
        public void setIssuedAt(Instant issuedAt) { this.issuedAt = issuedAt; }

        public List<LabResult> getResults() { return results; }
        public void setResults(List<LabResult> results) { this.results = results; }

        public Facility getFacility() { return facility; }
        public void setFacility(Facility facility) { this.facility = facility; }

        public CodeableConcept getPanel() { return panel; }
        public void setPanel(CodeableConcept panel) { this.panel = panel; }

        public Specimen getSpecimen() { return specimen; }
        public void setSpecimen(Specimen specimen) { this.specimen = specimen; }
    }
}
