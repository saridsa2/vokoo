//! Driving Asterisk as a switch, over its REST interface.
//!
//! The point of this module is a shape that is easy to miss: **the AI is an
//! agent leg like any other.** Asterisk holds the caller on one channel and the
//! thing answering them on another, bridged together. Today that second channel
//! is an AudioSocket back to our own pipeline; tomorrow it is a human on a
//! WebRTC softphone, and escalation is swapping one for the other inside a
//! bridge the caller never leaves.
//!
//! That is worth the hop it costs. `kookoo.transfer` — the carrier-side
//! handover this replaces — has never been exercised on a real call, and on a
//! WhatsApp call it cannot work at all: it posts to KooKoo with a ucid KooKoo
//! has never heard of.
//!
//! ## Why REST and a WebSocket, rather than a crate
//!
//! ARI is a small REST API plus one event stream. The two verbs this needs —
//! originate a channel, move channels in and out of a bridge — are four
//! endpoints. `reqwest` and `tokio-tungstenite` are already in the binary for
//! the provider clients, so this adds no dependency to the thing that answers
//! the phone.
//!
//! ## The endpoint form that matters
//!
//! ```text
//! AudioSocket/<host>:<port>/<uuid>
//! ```
//!
//! Asterisk connects **out** to that host and port as a TCP client and sends
//! the uuid as its first frame — which is how a channel it originated is tied
//! back to the call we originated it for. `PendingCalls` already does that
//! matching for WhatsApp; this reuses it rather than inventing a second
//! registry.

use serde::Deserialize;
use serde_json::Value;

/// A connection to Asterisk's REST interface.
///
/// Cheap to clone: it is a URL, a credential and a `reqwest::Client`, which is
/// itself an `Arc` over a connection pool.
#[derive(Clone)]
pub struct Ari {
    base: String,
    user: String,
    password: String,
    http: reqwest::Client,
}

/// One endpoint, as Asterisk currently sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Presence {
    /// The PJSIP endpoint name — `<org slug>-<extension>`.
    pub endpoint: String,
    /// Registered and reachable.
    pub online: bool,
    /// How many channels this endpoint is on. Non-zero means on a call.
    pub calls: usize,
}

/// What happened, from the event stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AriEvent {
    /// A channel entered our Stasis application. `args` are the `appArgs` it
    /// was originated with, which is how the caller leg and the agent leg tell
    /// themselves apart.
    StasisStart { channel_id: String, args: Vec<String> },
    /// A channel left the application, usually because it hung up.
    StasisEnd { channel_id: String },
    /// An endpoint's registration changed — somebody went on or off duty.
    ///
    /// Deliberately carries no state, only the fact that something moved.
    /// Asterisk says this three different ways (`PeerStatusChange`,
    /// `ContactStatusChange`, `EndpointStateChange`) with three different
    /// payloads and its own rules about which fires when; deriving presence
    /// from the payload would be a second implementation of what
    /// `GET /ari/endpoints` already answers, free to disagree with it. So the
    /// event is a prompt to re-read, and the read is the source of truth.
    EndpointChanged,
    /// Something else. Carried rather than dropped so a new event type is a
    /// log line instead of a silent gap.
    Other(String),
}

#[derive(Deserialize)]
struct ChannelId {
    id: String,
}

impl Ari {
    /// Read the connection out of the environment, or say why it cannot.
    ///
    /// `None` rather than an error: a bridge with no ARI configured should
    /// still answer the phone the way it does today, not refuse to start.
    pub fn from_env() -> Option<Self> {
        let base = std::env::var("ARI_URL").ok()?;
        let user = std::env::var("ARI_USER").ok()?;
        let password = std::env::var("ARI_PASSWORD").ok()?;
        if base.is_empty() || user.is_empty() || password.is_empty() {
            return None;
        }
        Some(Self {
            base: base.trim_end_matches('/').to_string(),
            user,
            password,
            http: reqwest::Client::builder()
                // Asterisk is on loopback. A request that has not answered in
                // five seconds is not going to, and the caller is waiting.
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .ok()?,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/ari/{}", self.base, path.trim_start_matches('/'))
    }

    /// Prove the credentials work before a call depends on them.
    pub async fn ping(&self) -> Result<String, String> {
        let response = self
            .http
            .get(self.url("asterisk/info"))
            .basic_auth(&self.user, Some(&self.password))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("ari answered {}", response.status()));
        }
        let body: Value = response.json().await.map_err(|e| e.to_string())?;
        Ok(body
            .get("system")
            .and_then(|s| s.get("entity_id"))
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string())
    }

    /// Who is registered, and who is on a call.
    ///
    /// The only source for this. `agent_extensions.status` is active or
    /// suspended, which is employment; a registration lives in Asterisk's
    /// memory and nowhere else, deliberately — migration 0076 leaves
    /// `ps_contacts` unmapped because a thing that expires in five minutes has
    /// no business in a database.
    ///
    /// Three states rather than two, because `channel_ids` arrives in the same
    /// response and costs nothing: offline, online, or on a call. The
    /// difference between the last two is the difference between "nobody is
    /// available" and "everybody is busy", which are not the same problem.
    pub async fn endpoints(&self) -> Result<Vec<Presence>, String> {
        let response = self
            .http
            .get(self.url("endpoints"))
            .basic_auth(&self.user, Some(&self.password))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("ari answered {}", response.status()));
        }
        let rows: Vec<Value> = response.json().await.map_err(|e| e.to_string())?;
        Ok(rows
            .iter()
            .filter(|row| {
                row.get("technology").and_then(Value::as_str) == Some("PJSIP")
            })
            .filter_map(|row| {
                let name = row.get("resource").and_then(Value::as_str)?;
                let calls = row
                    .get("channel_ids")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0);
                Some(Presence {
                    endpoint: name.to_string(),
                    // Asterisk says "online" for an endpoint with a reachable
                    // contact. Anything else — offline, unknown — is somebody
                    // who cannot be rung, and telling those apart on a screen
                    // would be reporting Asterisk's internals as if they were
                    // facts about a person.
                    online: row.get("state").and_then(Value::as_str) == Some("online"),
                    calls,
                })
            })
            .collect())
    }

    /// Originate an AudioSocket channel that connects back to us and enters a
    /// Stasis application.
    ///
    /// `uuid` is what Asterisk sends as its first frame, and what ties the new
    /// channel to whatever we are building it for. `args` reach the
    /// application as `appArgs` and are how a leg says which side it is.
    pub async fn originate_audiosocket(
        &self,
        audiosocket: &str,
        uuid: &str,
        app: &str,
        args: &str,
        caller_id: Option<&str>,
    ) -> Result<String, String> {
        let endpoint = format!("AudioSocket/{audiosocket}/{uuid}");
        let mut query: Vec<(&str, String)> = vec![
            ("endpoint", endpoint),
            ("app", app.to_string()),
            ("appArgs", args.to_string()),
            // slin is 8 kHz signed linear — what AudioSocket carries and what
            // the serializer on the other end expects.
            ("formats", "slin".to_string()),
        ];
        if let Some(cid) = caller_id.filter(|c| !c.is_empty()) {
            query.push(("callerId", cid.to_string()));
        }

        let response = self
            .http
            .post(self.url("channels"))
            .basic_auth(&self.user, Some(&self.password))
            .query(&query)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!("originate answered {status}: {body}"));
        }
        let channel: ChannelId = response.json().await.map_err(|e| e.to_string())?;
        Ok(channel.id)
    }

    /// Originate any endpoint into a Stasis application.
    ///
    /// `PJSIP/sarvathra-4001` for a human agent. Separate from
    /// [`Self::originate_audiosocket`] only because that one builds its
    /// endpoint string from a host, port and uuid, and getting that shape
    /// wrong is answered with `Allocation failed` and nothing else.
    pub async fn originate_endpoint(
        &self,
        endpoint: &str,
        app: &str,
        args: &str,
        caller_id: Option<&str>,
    ) -> Result<String, String> {
        let mut query: Vec<(&str, String)> = vec![
            ("endpoint", endpoint.to_string()),
            ("app", app.to_string()),
            ("appArgs", args.to_string()),
        ];
        if let Some(cid) = caller_id.filter(|c| !c.is_empty()) {
            query.push(("callerId", cid.to_string()));
        }
        let response = self
            .http
            .post(self.url("channels"))
            .basic_auth(&self.user, Some(&self.password))
            .query(&query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!("originate {endpoint} answered {status}: {body}"));
        }
        let channel: ChannelId = response.json().await.map_err(|e| e.to_string())?;
        Ok(channel.id)
    }

    /// A mixing bridge, which is what puts two channels in the same
    /// conversation.
    pub async fn create_bridge(&self) -> Result<String, String> {
        let response = self
            .http
            .post(self.url("bridges"))
            .basic_auth(&self.user, Some(&self.password))
            .query(&[("type", "mixing")])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("create bridge answered {}", response.status()));
        }
        let bridge: ChannelId = response.json().await.map_err(|e| e.to_string())?;
        Ok(bridge.id)
    }

    /// Put channels into a bridge. Adding the caller and the agent is what
    /// makes them hear each other.
    pub async fn add_to_bridge(&self, bridge: &str, channels: &[&str]) -> Result<(), String> {
        let response = self
            .http
            .post(self.url(&format!("bridges/{bridge}/addChannel")))
            .basic_auth(&self.user, Some(&self.password))
            .query(&[("channel", channels.join(","))])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("addChannel answered {status}: {body}"));
        }
        Ok(())
    }

    /// Take one channel out of a bridge without ending the call.
    ///
    /// This is the escalation move: remove the AI leg, add a human's, and the
    /// caller is never moved or re-dialled.
    pub async fn remove_from_bridge(&self, bridge: &str, channel: &str) -> Result<(), String> {
        let response = self
            .http
            .post(self.url(&format!("bridges/{bridge}/removeChannel")))
            .basic_auth(&self.user, Some(&self.password))
            .query(&[("channel", channel)])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("removeChannel answered {}", response.status()));
        }
        Ok(())
    }

    /// Best effort: a channel that is already gone is not a failure worth
    /// reporting to a caller who has hung up.
    pub async fn hangup(&self, channel: &str) {
        let _ = self
            .http
            .delete(self.url(&format!("channels/{channel}")))
            .basic_auth(&self.user, Some(&self.password))
            .send()
            .await;
    }

    pub async fn destroy_bridge(&self, bridge: &str) {
        let _ = self
            .http
            .delete(self.url(&format!("bridges/{bridge}")))
            .basic_auth(&self.user, Some(&self.password))
            .send()
            .await;
    }

    /// The WebSocket URL for a Stasis application's event stream.
    ///
    /// ARI takes the credential in the query string here rather than in a
    /// header, which is its own decision and not ours — worth knowing because
    /// it means the password can end up in a proxy log if this ever leaves
    /// loopback.
    pub fn events_url(&self, app: &str) -> String {
        let ws = self.base.replacen("http://", "ws://", 1).replacen("https://", "wss://", 1);
        format!(
            "{ws}/ari/events?app={app}&subscribeAll=true&api_key={}:{}",
            self.user, self.password
        )
    }
}

/// Turn one ARI event frame into something worth acting on.
pub fn parse_event(text: &str) -> AriEvent {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return AriEvent::Other("unparseable".into());
    };
    let kind = value.get("type").and_then(Value::as_str).unwrap_or_default();
    let channel_id = value
        .get("channel")
        .and_then(|c| c.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    match kind {
        "StasisStart" => AriEvent::StasisStart {
            channel_id,
            args: value
                .get("args")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(str::to_owned).collect())
                .unwrap_or_default(),
        },
        "StasisEnd" => AriEvent::StasisEnd { channel_id },
        "PeerStatusChange" | "ContactStatusChange" | "EndpointStateChange" => {
            AriEvent::EndpointChanged
        }
        other => AriEvent::Other(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stasis_start_carries_its_app_args() {
        // `args` is how a leg says which side of the call it is. Losing them
        // means the agent leg and the caller leg are indistinguishable, and the
        // application bridges a channel to itself.
        let event = parse_event(
            r#"{"type":"StasisStart","args":["agent","abc"],"channel":{"id":"1234.5"}}"#,
        );
        assert_eq!(
            event,
            AriEvent::StasisStart {
                channel_id: "1234.5".into(),
                args: vec!["agent".into(), "abc".into()],
            }
        );
    }

    #[test]
    fn an_event_with_no_args_is_still_a_start() {
        let event = parse_event(r#"{"type":"StasisStart","channel":{"id":"9.9"}}"#);
        assert_eq!(event, AriEvent::StasisStart { channel_id: "9.9".into(), args: vec![] });
    }

    #[test]
    fn an_unknown_event_is_named_not_dropped() {
        // A new event type should read as a log line, never as a silent gap.
        assert_eq!(
            parse_event(r#"{"type":"ChannelDtmfReceived","channel":{"id":"1"}}"#),
            AriEvent::Other("ChannelDtmfReceived".into()),
        );
        assert_eq!(parse_event("not json"), AriEvent::Other("unparseable".into()));
    }

    #[test]
    fn the_event_url_is_a_websocket() {
        let ari = Ari {
            base: "http://127.0.0.1:8088".into(),
            user: "vokoo".into(),
            password: "secret".into(),
            http: reqwest::Client::new(),
        };
        let url = ari.events_url("sarvathra");
        assert!(url.starts_with("ws://127.0.0.1:8088/ari/events?app=sarvathra"), "{url}");
        assert!(url.contains("api_key=vokoo:secret"));
    }

    #[test]
    fn paths_do_not_double_their_slashes() {
        let ari = Ari {
            base: "http://127.0.0.1:8088".into(),
            user: "u".into(),
            password: "p".into(),
            http: reqwest::Client::new(),
        };
        assert_eq!(ari.url("channels"), "http://127.0.0.1:8088/ari/channels");
        assert_eq!(ari.url("/channels"), "http://127.0.0.1:8088/ari/channels");
    }
}
