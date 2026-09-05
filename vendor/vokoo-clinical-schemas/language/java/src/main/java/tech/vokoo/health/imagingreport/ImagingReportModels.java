package tech.vokoo.health.imagingreport;

import com.fasterxml.jackson.annotation.JsonInclude;
import tech.vokoo.health.common.Common.*;

import java.time.Instant;
import java.util.List;

/**
 * Imaging Report data models.
 *
 * Package: tech.vokoo.health
 * Website: https://github.com/saridsa2/vokoo
 * Schema: urn:vokoo:clinical:schema:imaging-report:v0.1.0
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ImagingReportModels {

    /**
     * Imaging report performer (radiologist).
     */
    public static class Performer {
        private String id;
        private String name;
        private String role;

        public Performer() {}

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }

        public String getRole() { return role; }
        public void setRole(String role) { this.role = role; }
    }

    /**
     * CT radiation dose information.
     */
    public static class RadiationDose {
        /**
         * CT Dose Index Volume (mGy)
         */
        private Double ctdiVol_mGy;

        /**
         * Dose Length Product (mGy·cm)
         */
        private Double dlp_mGy_cm;

        public RadiationDose() {}

        public Double getCtdiVol_mGy() { return ctdiVol_mGy; }
        public void setCtdiVol_mGy(Double ctdiVol_mGy) { this.ctdiVol_mGy = ctdiVol_mGy; }

        public Double getDlp_mGy_cm() { return dlp_mGy_cm; }
        public void setDlp_mGy_cm(Double dlp_mGy_cm) { this.dlp_mGy_cm = dlp_mGy_cm; }
    }

    /**
     * Report attachment (image, PDF, etc.).
     */
    public static class Attachment {
        private String url;
        private String type;

        public Attachment() {}

        public String getUrl() { return url; }
        public void setUrl(String url) { this.url = url; }

        public String getType() { return type; }
        public void setType(String type) { this.type = type; }
    }

    /**
     * Diagnostic imaging report.
     */
    public static class ImagingReport {
        /**
         * Unique report identifier
         */
        private String id;

        /**
         * Reference to Person.id
         */
        private String patientId;

        /**
         * Imaging modality (CT, MR, US, XR, PT)
         */
        private Modality modality;

        /**
         * Body site examined (SNOMED CT code)
         */
        private Coding bodySite;

        /**
         * Report timestamp
         */
        private Instant reportedAt;

        /**
         * DICOM Study Instance UID
         */
        private String studyInstanceUid;

        /**
         * Radiologist information
         */
        private Performer performer;

        /**
         * Imaging findings list
         */
        private List<String> findings;

        /**
         * Diagnostic impression/conclusion
         */
        private String impression;

        /**
         * Radiation dose (for CT)
         */
        private RadiationDose radiationDose;

        /**
         * Attached files
         */
        private List<Attachment> attachments;

        public ImagingReport() {}

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }

        public String getPatientId() { return patientId; }
        public void setPatientId(String patientId) { this.patientId = patientId; }

        public Modality getModality() { return modality; }
        public void setModality(Modality modality) { this.modality = modality; }

        public Coding getBodySite() { return bodySite; }
        public void setBodySite(Coding bodySite) { this.bodySite = bodySite; }

        public Instant getReportedAt() { return reportedAt; }
        public void setReportedAt(Instant reportedAt) { this.reportedAt = reportedAt; }

        public String getStudyInstanceUid() { return studyInstanceUid; }
        public void setStudyInstanceUid(String studyInstanceUid) { this.studyInstanceUid = studyInstanceUid; }

        public Performer getPerformer() { return performer; }
        public void setPerformer(Performer performer) { this.performer = performer; }

        public List<String> getFindings() { return findings; }
        public void setFindings(List<String> findings) { this.findings = findings; }

        public String getImpression() { return impression; }
        public void setImpression(String impression) { this.impression = impression; }

        public RadiationDose getRadiationDose() { return radiationDose; }
        public void setRadiationDose(RadiationDose radiationDose) { this.radiationDose = radiationDose; }

        public List<Attachment> getAttachments() { return attachments; }
        public void setAttachments(List<Attachment> attachments) { this.attachments = attachments; }
    }
}
