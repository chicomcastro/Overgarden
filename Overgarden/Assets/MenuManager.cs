using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class MenuManager : MonoBehaviour
{
    public static MenuManager instance;

    public bool isPaused;
    public GameObject pauseMenu;

    private void Start()
    {
        isPaused = true;
        instance = this;
        pauseMenu.SetActive(false);
    }

    // Update is called once per frame
    void Update()
    {
        if (Input.GetKeyDown(KeyCode.P) && Camera.main.gameObject.GetComponent<Animator>().GetBool("startGame"))
        {
            PauseGame();
        }
    }

    public void LoadMenu()
    {
        Camera.main.gameObject.GetComponent<Animator>().SetBool("startGame", false);
        Camera.main.gameObject.GetComponent<Animator>().Play("camera-menu");
    }

    public void PauseGame()
    {
        isPaused = !isPaused;
        pauseMenu.SetActive(!pauseMenu.activeInHierarchy);
    }

    public void StartGame() {
        isPaused = false;
        Camera.main.gameObject.GetComponent<Animator>().SetBool("startGame", true);
    }
}
