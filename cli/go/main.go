package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/AlecAivazis/survey/v2"
)

type Config struct {
	BaseURL string `json:"base_url"`
}

type Session struct {
	Token string `json:"token"`
}

var baseURL string
var token string
var configDir string

func init() {
	home, _ := os.UserHomeDir()
	configDir = filepath.Join(home, ".config", "hydrooj_cli")
	baseURL = "http://localhost:3000"
	// Try to load config
	configFile := filepath.Join(configDir, "config.json")
	if data, err := os.ReadFile(configFile); err == nil {
		var cfg Config
		if json.Unmarshal(data, &cfg) == nil && cfg.BaseURL != "" {
			baseURL = cfg.BaseURL
		}
	}
	// Try to load session
	sessionFile := filepath.Join(configDir, "session.json")
	if data, err := os.ReadFile(sessionFile); err == nil {
		var sess Session
		if json.Unmarshal(data, &sess) == nil {
			token = sess.Token
		}
	}
}

func apiRequest(method, path string, body interface{}) (map[string]interface{}, error) {
	var bodyReader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		bodyReader = strings.NewReader(string(data))
	}

	req, err := http.NewRequest(method, baseURL+path, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error: %v", result["message"])
	}

	return result, nil
}

func login() {
	var username, password string
	survey.Ask([]*survey.Question{
		{Name: "username", Prompt: &survey.Input{Message: "Username:"}},
		{Name: "password", Prompt: &survey.Password{Message: "Password:"}},
	}, &username)

	fmt.Print("Password: ")
	reader := bufio.NewReader(os.Stdin)
	password, _ = reader.ReadString('\n')
	password = strings.TrimSpace(password)

	result, err := apiRequest("GET", "/api/login?username="+username+"&password="+password, nil)
	if err != nil {
		fmt.Printf("Login failed: %v\n", err)
		os.Exit(1)
	}

	token = result["token"].(string)
	os.MkdirAll(configDir, 0755)
	data, _ := json.Marshal(Session{Token: token})
	os.WriteFile(filepath.Join(configDir, "session.json"), data, 0600)

	fmt.Printf("Logged in as %s (uid=%v)\n", result["uname"], result["uid"])
}

func listProblems() {
	result, err := apiRequest("GET", "/api/problems?page=1&pageSize=20", nil)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	fmt.Printf("\nProblems (Total: %v)\n", result["total"])
	items := result["items"].([]interface{})
	for _, item := range items {
		p := item.(map[string]interface{})
		tags := p["tag"]
		tagStr := ""
		if tags != nil {
			tagList := tags.([]interface{})
			strs := make([]string, len(tagList))
			for i, t := range tagList {
				strs[i] = fmt.Sprintf("%v", t)
			}
			tagStr = strings.Join(strs, ", ")
		}
		fmt.Printf("  [%v] %s (Difficulty: %v, Tags: %s)\n", p["pid"], p["title"], p["difficulty"], tagStr)
	}
}

func showProblem(id string) {
	result, err := apiRequest("GET", "/api/problems/"+id, nil)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	fmt.Printf("\n#%v: %s\n", result["pid"], result["title"])
	fmt.Printf("Difficulty: %v\n", result["difficulty"])
	fmt.Printf("Time Limit: %vms\n", result["timeLimit"])
	fmt.Printf("Memory Limit: %vMB\n", result["memoryLimit"])
	fmt.Printf("\n%v\n", result["content"])

	if samples, ok := result["samples"].([]interface{}); ok && len(samples) > 0 {
		fmt.Println("\nSamples:")
		for i, s := range samples {
			sample := s.(map[string]interface{})
			fmt.Printf("\nSample %d:\n", i+1)
			fmt.Printf("  Input: %v\n", sample["input"])
			fmt.Printf("  Output: %v\n", sample["output"])
		}
	}
}

func submit(id, lang, file string) {
	var code string
	if file != "" {
		data, err := os.ReadFile(file)
		if err != nil {
			fmt.Printf("Error reading file: %v\n", err)
			return
		}
		code = string(data)
	} else {
		fmt.Println("Enter code (Ctrl+D to finish):")
		reader := bufio.NewReader(os.Stdin)
		data, _ := io.ReadAll(reader)
		code = string(data)
	}

	result, err := apiRequest("POST", "/api/submit", map[string]interface{}{
		"problemId": id,
		"code":      code,
		"language":  lang,
	})
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	fmt.Printf("Submitted! Submission ID: %v\n", result["id"])
	fmt.Println("Use `hydrooj status <id>` to check the result.")
}

func showStatus(id string) {
	if id == "" {
		result, err := apiRequest("GET", "/api/submissions?page=1&pageSize=20", nil)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			return
		}
		fmt.Println("\nRecent Submissions")
		items := result["items"].([]interface{})
		for _, item := range items {
			s := item.(map[string]interface{})
			fmt.Printf("  [%v] #%v - %v (%v%%)\n", s["id"], s["pid"], s["status"], s["score"])
		}
	} else {
		result, err := apiRequest("GET", "/api/submissions/"+id, nil)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			return
		}
		fmt.Printf("\nSubmission #%v\n", result["id"])
		fmt.Printf("Problem: #%v\n", result["pid"])
		fmt.Printf("Status: %v\n", result["status"])
		fmt.Printf("Score: %v%%\n", result["score"])
		fmt.Printf("Time: %vms\n", result["time"])
		fmt.Printf("Memory: %vKB\n", result["memory"])
		fmt.Printf("Language: %v\n", result["language"])
	}
}

func listContests() {
	result, err := apiRequest("GET", "/api/contests?page=1&pageSize=20", nil)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	fmt.Printf("\nContests (Total: %v)\n", result["total"])
	items := result["items"].([]interface{})
	for _, item := range items {
		c := item.(map[string]interface{})
		fmt.Printf("  [%v] %s (%v)\n", c["id"], c["title"], c["status"])
	}
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: hydrooj <command> [args]")
		fmt.Println("\nCommands:")
		fmt.Println("  login              Login to HydroOJ")
		fmt.Println("  list               List problems")
		fmt.Println("  show <id>          Show problem details")
		fmt.Println("  submit <id>        Submit code")
		fmt.Println("  status [id]         Check submission status")
		fmt.Println("  contests           List contests")
		os.Exit(1)
	}

	cmd := os.Args[1]

	switch cmd {
	case "login":
		login()
	case "list":
		listProblems()
	case "show":
		if len(os.Args) < 3 {
			fmt.Println("Usage: hydrooj show <problem_id>")
			os.Exit(1)
		}
		showProblem(os.Args[2])
	case "submit":
		if len(os.Args) < 3 {
			fmt.Println("Usage: hydrooj submit <problem_id> [-f file] [-l language]")
			os.Exit(1)
		}
		id := os.Args[2]
		lang := "cpp"
		file := ""
		for i := 3; i < len(os.Args); i++ {
			if os.Args[i] == "-f" && i+1 < len(os.Args) {
				file = os.Args[i+1]
				i++
			}
			if os.Args[i] == "-l" && i+1 < len(os.Args) {
				lang = os.Args[i+1]
				i++
			}
		}
		submit(id, lang, file)
	case "status":
		id := ""
		if len(os.Args) >= 3 {
			id = os.Args[2]
		}
		showStatus(id)
	case "contests":
		listContests()
	default:
		fmt.Printf("Unknown command: %s\n", cmd)
		os.Exit(1)
	}
}
