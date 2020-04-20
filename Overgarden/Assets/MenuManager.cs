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
        isPaused = false;
        instance = this;
        pauseMenu.SetActive(false);
    }

    // Update is called once per frame
    void Update()
    {
        if (Input.GetKeyDown(KeyCode.P))
        {
            PauseGame();
        }
    }

    public void LoadMenu()
    {
        UnityEngine.SceneManagement.SceneManager.LoadScene("Menu");
    }

    public void PauseGame()
    {
        isPaused = !isPaused;
        pauseMenu.SetActive(!pauseMenu.activeInHierarchy);
    }
}
