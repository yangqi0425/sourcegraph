package e2eutil

import (
	"bytes"
	"fmt"
	"io/ioutil"
	"net/http"
	"strings"

	jsoniter "github.com/json-iterator/go"
	"github.com/pkg/errors"
)

// SiteAdminInit initializes the instance with given admin account.
// It returns an authenticated client as the admin for doing e2e testing.
func SiteAdminInit(baseURL, email, username, password string) (*Client, error) {
	client, err := newClient(baseURL)
	if err != nil {
		return nil, errors.Wrap(err, "new client")
	}

	var request = struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Password string `json:"password"`
	}{
		Email:    email,
		Username: username,
		Password: password,
	}
	err = client.authenticate("/-/site-init", request)
	if err != nil {
		return nil, errors.Wrap(err, "authenticate")
	}

	return client, nil
}

// SignIn performs the sign in with given user credentials.
// It returns an authenticated client as the user for doing e2e testing.
func SignIn(baseURL string, email, password string) (*Client, error) {
	client, err := newClient(baseURL)
	if err != nil {
		return nil, errors.Wrap(err, "new client")
	}

	var request = struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}{
		Email:    email,
		Password: password,
	}
	err = client.authenticate("/-/sign-in", request)
	if err != nil {
		return nil, errors.Wrap(err, "authenticate")
	}

	return client, nil
}

// extractCSRFToken extracts CSRF token from HTML response body.
func extractCSRFToken(body string) string {
	anchor := `X-Csrf-Token":"`
	i := strings.Index(body, anchor)
	if i == -1 {
		return ""
	}

	j := strings.Index(body[i+len(anchor):], `","`)
	if j == -1 {
		return ""
	}

	return body[i+len(anchor) : i+len(anchor)+j]
}

// Client is an authenticated client for a Sourcegraph user for doing e2e testing.
// The user may or may not be a site admin depends on how the client is instantiated.
// It works by simulating how the browser would send HTTP requests to the server.
type Client struct {
	baseURL       string
	csrfToken     string
	csrfCookie    *http.Cookie
	sessionCookie *http.Cookie

	userID string
}

// newClient instantiates a new client by performing a GET request then obtains the
// CSRF token and cookie from its response.
func newClient(baseURL string) (*Client, error) {
	resp, err := http.Get(baseURL)
	if err != nil {
		return nil, errors.Wrap(err, "get URL")
	}
	defer func() { _ = resp.Body.Close() }()

	p, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, errors.Wrap(err, "read GET body")
	}

	csrfToken := extractCSRFToken(string(p))
	if csrfToken == "" {
		return nil, errors.Wrap(err, `"X-Csrf-Token" not found in the response body`)
	}
	var csrfCookie *http.Cookie
	for _, cookie := range resp.Cookies() {
		if cookie.Name == "sg_csrf_token" {
			csrfCookie = cookie
			break
		}
	}
	if csrfCookie == nil {
		return nil, errors.Wrap(err, `"sg_csrf_token" cookie not found`)
	}

	return &Client{
		baseURL:    baseURL,
		csrfToken:  csrfToken,
		csrfCookie: csrfCookie,
	}, nil
}

// authenticate is used to send a HTTP POST request to an URL that is able to authenticate
// a user with given body (marshalled to JSON), e.g. site admin init, sign in. Once the
// client is authenticated, the session cookie will be stored as a proof of authentication.
func (c *Client) authenticate(path string, body interface{}) error {
	p, err := jsoniter.Marshal(body)
	if err != nil {
		return errors.Wrap(err, "marshal body")
	}

	req, err := http.NewRequest("POST", c.baseURL+path, bytes.NewReader(p))
	if err != nil {
		return errors.Wrap(err, "new request")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Csrf-Token", c.csrfToken)
	req.AddCookie(c.csrfCookie)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return errors.Wrap(err, "do request")
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		p, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return errors.Wrap(err, "read response body")
		}
		return errors.New(string(p))
	}

	var sessionCookie *http.Cookie
	for _, cookie := range resp.Cookies() {
		if cookie.Name == "sgs" {
			sessionCookie = cookie
			break
		}
	}
	if sessionCookie == nil {
		return errors.Wrap(err, `"sgs" cookie not found`)
	}
	c.sessionCookie = sessionCookie

	userID, err := c.currentUserID()
	if err != nil {
		return errors.Wrap(err, "get current user")
	}
	c.userID = userID
	return nil
}

// currentUserID returns the current user's GraphQL node ID.
func (c *Client) currentUserID() (string, error) {
	const query = `
	query {
		currentUser {
			id
		}
	}
`
	var resp struct {
		Data struct {
			CurrentUser struct {
				ID string `json:"id"`
			} `json:"currentUser"`
		} `json:"data"`
	}
	err := c.GraphQL("", query, nil, &resp)
	if err != nil {
		return "", errors.Wrap(err, "request GraphQL")
	}

	return resp.Data.CurrentUser.ID, nil
}

// GraphQL makes a GraphQL request to the server on behalf of the user authenticated by the client.
// An optional token can be passed to impersonate other users. A nil target will skip unmarshalling
// the returned JSON response.
func (c *Client) GraphQL(token, query string, variables map[string]interface{}, target interface{}) error {
	body, err := jsoniter.Marshal(map[string]interface{}{
		"query":     query,
		"variables": variables,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", fmt.Sprintf("%s/.api/graphql", c.baseURL), bytes.NewReader(body))
	if err != nil {
		return err
	}
	if token != "" {
		req.Header.Set("Authorization", fmt.Sprintf("token %s", token))
	} else {
		// NOTE: We use this header to protect from CSRF attacks of HTTP API,
		// see https://sourcegraph.com/github.com/sourcegraph/sourcegraph/-/blob/cmd/frontend/internal/cli/http.go#L41-42
		req.Header.Set("X-Requested-With", "Sourcegraph")
		req.AddCookie(c.csrfCookie)
		req.AddCookie(c.sessionCookie)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		p, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return errors.Wrap(err, "read response body")
		}
		return errors.New(string(p))
	}

	if target == nil {
		return nil
	}

	return jsoniter.NewDecoder(resp.Body).Decode(target)
}
